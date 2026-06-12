import { query } from "@/lib/db";
import { successResponse, errorResponse } from "@/lib/api-response";
import { extractAuthUser, requirePermission } from "@/lib/api-protection";
import { ensureSalesReturnsSchema } from "@/lib/salesReturnsSchema";
import {
  ensureInventoryBatchSchema,
  receiveBatchStock,
  restoreBatchStock,
} from "@/lib/inventoryBatching";
import { ensureStockInSchema } from "@/lib/stockInSchema";

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundQty(value) {
  return Math.round(toNumber(value) * 1000) / 1000;
}

function isWholeQty(value) {
  const qty = Number(value);
  return Number.isInteger(qty) && qty > 0;
}

function isSuperAdmin(user) {
  return user?.role === "super_admin";
}

function isStoreAdmin(user, storeId) {
  return (
    user?.role === "admin" &&
    (user.assigned_stores || []).map(Number).includes(Number(storeId))
  );
}

function canReviewReturn(user, storeId) {
  return isSuperAdmin(user) || isStoreAdmin(user, storeId);
}

function canCompleteReturn(user, returnRow) {
  return (
    Number(returnRow.created_by) === Number(user?.id) ||
    canReviewReturn(user, returnRow.store_id)
  );
}

function parseBatchAllocations(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Create return/exchange
export async function POST(req) {
  try {
    await ensureSalesReturnsSchema();
    await ensureInventoryBatchSchema();
    await ensureStockInSchema();

    const auth = await extractAuthUser(req);
    if (auth.error || !auth.user)
      return errorResponse(auth.error || "Unauthorized", 401);
    const permissionCheck = requirePermission(
      auth.user,
      "CREATE_POS_BILL",
      "MANAGE_BILLING",
      "MANAGE_ORDERS",
    );
    if (permissionCheck.error) return permissionCheck.error;
    const user = auth.user;

    const body = await req.json();
    const {
      original_bill_id,
      return_type = "return", // return, exchange
      reason,
      items = [],
      refund_amount = 0,
      store_id,
    } = body;

    if (!original_bill_id || items.length === 0) {
      return errorResponse("Missing required fields", 400);
    }

    const billLookup = String(original_bill_id).trim();
    const isNumericBillId = /^\d+$/.test(billLookup);
    const billRes = await query(
      isNumericBillId
        ? "SELECT * FROM sales_bills WHERE id = $1"
        : "SELECT * FROM sales_bills WHERE bill_number = $1",
      [billLookup],
    );

    if (!billRes.rows.length) {
      return errorResponse("Original bill not found", 404);
    }

    const bill = billRes.rows[0];
    const requestStoreId = Number(store_id || bill.store_id || 0) || null;
    const isGlobalAccess = isSuperAdmin(user);
    const assignedStores = (user.assigned_stores || []).map(Number);
    if (
      !isGlobalAccess &&
      requestStoreId &&
      !assignedStores.includes(requestStoreId)
    ) {
      return errorResponse("You do not have access to this store", 403);
    }

    const productIds = items
      .map((item) => Number(item.product_id))
      .filter(Number.isFinite);
    if (!productIds.length)
      return errorResponse("Select valid products to return", 400);

    const duplicateRes = await query(
      `SELECT
         sri.product_id,
         COALESCE(p.name, 'Product') AS product_name,
         sr.id AS return_id,
         sr.status
       FROM sales_return_items sri
       INNER JOIN sales_returns sr ON sr.id = sri.sales_return_id
       LEFT JOIN products p ON p.id = sri.product_id
       WHERE sr.original_bill_id = $1
         AND sri.product_id = ANY($2::bigint[])
         AND sr.status <> 'declined'
       ORDER BY sr.updated_at DESC, sr.id DESC
       LIMIT 1`,
      [bill.id, productIds],
    );

    if (duplicateRes.rows.length) {
      const duplicate = duplicateRes.rows[0];
      const label =
        duplicate.status === "completed"
          ? "already completed"
          : duplicate.status === "approved"
            ? "approved and waiting for proceed"
            : "already pending for approval";
      return errorResponse(
        `${duplicate.product_name} return is ${label} on this invoice (request #${duplicate.return_id})`,
        409,
      );
    }

    const requestedByProduct = new Map();
    for (const item of items) {
      const productId = Number(item.product_id);
      const qty = roundQty(item.qty);
      if (!Number.isFinite(productId) || productId <= 0 || qty <= 0) {
        return errorResponse("Return quantity must be greater than 0", 400);
      }
      if (!isWholeQty(item.qty)) {
        return errorResponse("Return quantity must be a whole number", 400);
      }
      requestedByProduct.set(productId, roundQty((requestedByProduct.get(productId) || 0) + qty));
    }

    const soldQtyRes = await query(
      `SELECT
         sbi.product_id,
         COALESCE(p.name, MAX(sbi.product_name), 'Product') AS product_name,
         SUM(COALESCE(sbi.qty, 0))::numeric AS sold_qty,
         COALESCE(returned.returned_qty, 0)::numeric AS returned_qty
       FROM sales_bill_items sbi
       LEFT JOIN products p ON p.id = sbi.product_id
       LEFT JOIN LATERAL (
         SELECT SUM(COALESCE(sri.qty, 0))::numeric AS returned_qty
         FROM sales_return_items sri
         INNER JOIN sales_returns sr ON sr.id = sri.sales_return_id
         WHERE sr.original_bill_id = sbi.sales_bill_id
           AND sri.product_id = sbi.product_id
           AND sr.status <> 'declined'
       ) returned ON TRUE
       WHERE sbi.sales_bill_id = $1
         AND sbi.product_id = ANY($2::bigint[])
       GROUP BY sbi.product_id, p.name, returned.returned_qty`,
      [bill.id, Array.from(requestedByProduct.keys())],
    );

    const soldByProduct = new Map(soldQtyRes.rows.map((row) => [Number(row.product_id), row]));
    for (const [productId, requestedQty] of requestedByProduct.entries()) {
      const row = soldByProduct.get(productId);
      const soldQty = roundQty(row?.sold_qty);
      const returnedQty = roundQty(row?.returned_qty);
      const remainingQty = Math.max(0, roundQty(soldQty - returnedQty));
      if (!row || requestedQty > remainingQty) {
        return errorResponse(
          `${row?.product_name || "Product"} return qty cannot exceed purchased qty. Purchased: ${soldQty}, already returned/requested: ${returnedQty}, allowed: ${remainingQty}`,
          400,
        );
      }
    }

    // Create approval request. Stock is updated only after admin/super admin approval.
    const returnRes = await query(
      `
      INSERT INTO sales_returns (
        original_bill_id, return_type, reason, refund_amount, 
        created_by, status, store_id
      ) VALUES ($1, $2, $3, $4, $5, 'pending', $6)
      RETURNING id
    `,
      [bill.id, return_type, reason, refund_amount, user.id, requestStoreId],
    );

    const return_id = returnRes.rows[0]?.id;

    // Add returned items
    for (const item of items) {
      await query(
        `
        INSERT INTO sales_return_items (
          sales_return_id, product_id, qty, original_price
        ) VALUES ($1, $2, $3, $4)
      `,
        [return_id, item.product_id, item.qty, item.original_price],
      );
    }

    return successResponse(
      {
        return_id,
        return_type,
        refund_amount,
        status: "pending",
      },
      "Return request sent for approval",
    );
  } catch (err) {
    console.error("Return creation error:", err);
    return errorResponse(err.message);
  }
}

// Get returns list
export async function GET(req) {
  try {
    await ensureSalesReturnsSchema();
    await ensureStockInSchema();

    const auth = await extractAuthUser(req);
    if (auth.error || !auth.user)
      return errorResponse(auth.error || "Unauthorized", 401);
    const permissionCheck = requirePermission(
      auth.user,
      "CREATE_POS_BILL",
      "MANAGE_BILLING",
      "VIEW_ORDERS",
      "MANAGE_ORDERS",
    );
    if (permissionCheck.error) return permissionCheck.error;

    const { searchParams } = new URL(req.url);
    const bill_id = searchParams.get("bill_id");
    const store_id = searchParams.get("store_id");
    const status = searchParams.get("status");
    const scope = searchParams.get("scope");
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("pageSize") || "100", 10), 1),
      200,
    );

    let query_str = `
      SELECT
        sr.*,
        sb.bill_number,
        sb.grand_total as original_amount,
        sb.customer_name,
        sb.customer_mobile,
        sb.payment_mode AS original_payment_mode,
        sb.payment_meta AS original_payment_meta,
        sb.created_at AS original_bill_date,
        sb.public_token AS original_public_token,
        s.name as store_name,
        u.name as requested_by_name,
        approver.name as approved_by_name,
        completer.name as completed_by_name,
        COALESCE(items.items, '[]'::jsonb) AS items
      FROM sales_returns sr
      LEFT JOIN sales_bills sb ON sr.original_bill_id = sb.id
      LEFT JOIN stores s ON sr.store_id = s.id
      LEFT JOIN users u ON sr.created_by = u.id
      LEFT JOIN users approver ON sr.approved_by = approver.id
      LEFT JOIN users completer ON sr.completed_by = completer.id
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', sri.id,
            'product_id', sri.product_id,
            'product_name', COALESCE(p.name, 'Product'),
            'sku', p.sku,
            'qty', sri.qty,
            'original_price', sri.original_price,
            'line_total', sri.qty * sri.original_price
          )
          ORDER BY sri.id
        ) AS items
        FROM sales_return_items sri
        LEFT JOIN products p ON p.id = sri.product_id
        WHERE sri.sales_return_id = sr.id
      ) items ON TRUE
      WHERE 1=1
    `;

    const params = [];
    const user = auth.user;

    if (scope === "mine") {
      query_str += ` AND sr.created_by = $${params.length + 1}`;
      params.push(user.id);
    } else if (!isSuperAdmin(user)) {
      const assignedStores = (user.assigned_stores || [])
        .map(Number)
        .filter(Number.isFinite);
      if (assignedStores.length === 0) return successResponse([]);
      params.push(assignedStores);
      query_str += ` AND sr.store_id = ANY($${params.length}::int[])`;
    }

    if (bill_id) {
      query_str += ` AND sr.original_bill_id = $${params.length + 1}`;
      params.push(bill_id);
    }

    if (store_id) {
      query_str += ` AND sr.store_id = $${params.length + 1}`;
      params.push(store_id);
    }

    if (status === "reviewed") {
      query_str += ` AND sr.status IN ('approved', 'declined')`;
    } else if (status) {
      query_str += ` AND sr.status = $${params.length + 1}`;
      params.push(status);
    }

    params.push(limit);
    query_str += ` ORDER BY sr.created_at DESC LIMIT $${params.length}`;

    const res = await query(query_str, params);

    return successResponse(res.rows || []);
  } catch (err) {
    return errorResponse(err.message);
  }
}

export async function PATCH(req) {
  try {
    await ensureSalesReturnsSchema();
    await ensureStockInSchema();
    await ensureInventoryBatchSchema();

    const auth = await extractAuthUser(req);
    if (auth.error || !auth.user)
      return errorResponse(auth.error || "Unauthorized", 401);
    const permissionCheck = requirePermission(
      auth.user,
      "CREATE_POS_BILL",
      "MANAGE_BILLING",
      "MANAGE_ORDERS",
    );
    if (permissionCheck.error) return permissionCheck.error;

    const body = await req.json();
    const returnId = Number(body.return_id || body.id);
    const action = String(body.action || "").toLowerCase();
    const rejectionReason = body.rejection_reason || "";

    if (
      !returnId ||
      !["approve", "decline", "reject", "complete", "proceed"].includes(action)
    ) {
      return errorResponse("Valid return_id and action are required", 400);
    }

    const returnRes = await query("SELECT * FROM sales_returns WHERE id = $1", [
      returnId,
    ]);
    const returnRow = returnRes.rows[0];
    if (!returnRow) return errorResponse("Return request not found", 404);

    if (action === "complete" || action === "proceed") {
      if (returnRow.status !== "approved")
        return errorResponse(
          "Only approved return requests can be completed",
          400,
        );
      if (!canCompleteReturn(auth.user, returnRow)) {
        return errorResponse(
          "Only the requesting employee, store admin, or super admin can complete this return",
          403,
        );
      }

      const billRes = await query("SELECT * FROM sales_bills WHERE id = $1", [
        returnRow.original_bill_id,
      ]);
      const bill = billRes.rows[0] || {};
      const refundPaymentMode =
        String(
          body.refund_payment_mode ||
            body.payment_mode ||
            bill.payment_mode ||
            "cash",
        ).trim() || "cash";
      const refundReference = String(
        body.refund_reference || body.reference_no || "",
      ).trim();
      const returnNumber =
        returnRow.return_number ||
        `RET-${returnId}-${Date.now().toString().slice(-6)}`;
      const receipt = {
        returnNumber,
        returnId,
        billNumber: bill.bill_number || returnRow.original_bill_id,
        customerName: bill.customer_name || "Walk-in Customer",
        customerMobile: bill.customer_mobile || "",
        storeId: returnRow.store_id,
        refundAmount: toNumber(returnRow.refund_amount),
        refundPaymentMode,
        refundReference,
        completedBy: auth.user.id,
        completedAt: new Date().toISOString(),
      };

      const completed = await query(
        `UPDATE sales_returns
         SET status = 'completed',
             completed_by = $1,
             completed_at = NOW(),
             refund_payment_mode = $2,
             refund_reference = $3,
             return_number = $4,
             meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('receipt', $5::jsonb),
             updated_at = NOW()
         WHERE id = $6
         RETURNING *`,
        [
          auth.user.id,
          refundPaymentMode,
          refundReference || null,
          returnNumber,
          JSON.stringify(receipt),
          returnId,
        ],
      );

      return successResponse(
        { ...completed.rows[0], receipt },
        "Return completed and receipt generated",
      );
    }

    if (returnRow.status !== "pending")
      return errorResponse("This request is already reviewed", 400);
    if (!canReviewReturn(auth.user, returnRow.store_id)) {
      return errorResponse(
        "Only this store admin or super admin can review this request",
        403,
      );
    }

    if (action === "decline" || action === "reject") {
      const declined = await query(
        `UPDATE sales_returns
         SET status = 'declined', rejected_by = $1, rejected_at = NOW(),
             rejection_reason = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [auth.user.id, rejectionReason, returnId],
      );
      return successResponse(declined.rows[0], "Return request declined");
    }

    const itemsRes = await query(
      `SELECT sri.*, p.name AS product_name
       FROM sales_return_items sri
       LEFT JOIN products p ON p.id = sri.product_id
       WHERE sri.sales_return_id = $1`,
      [returnId],
    );

    const totalQty = itemsRes.rows.reduce(
      (sum, item) => sum + toNumber(item.qty),
      0,
    );
    const totalCost = itemsRes.rows.reduce(
      (sum, item) => sum + toNumber(item.qty) * toNumber(item.original_price),
      0,
    );

    const stockInRes = await query(
      `INSERT INTO stock_in (
        transaction_id, method, destination_id, apply_taxes, add_products_prefill,
        status, vendor_name, invoice_date, invoice_number, remarks,
        total_items, total_cost, total_tax, reference_type, reference_id,
        meta, created_at, confirmed_at
      ) VALUES (
        $1, 'sales_return', $2, true, false,
        'confirmed', 'Sales Return', CURRENT_DATE, $3, $4,
        $5, $6, 0, 'sales_return', $7,
        $8::jsonb, NOW(), NOW()
      ) RETURNING id`,
      [
        `RET-STKI-${returnId}`,
        returnRow.store_id,
        `RETURN-${returnId}`,
        `Approved ${returnRow.return_type} request`,
        totalQty,
        totalCost,
        String(returnId),
        JSON.stringify({ source: "return-approval", approvedBy: auth.user.id }),
      ],
    );

    const stockInId = stockInRes.rows[0]?.id;
    for (const item of itemsRes.rows) {
      let remainingQty = toNumber(item.qty);
      const billItemsRes = await query(
        `SELECT id, selling_price, mrp, tax_rate, batch_allocations
         FROM sales_bill_items
         WHERE sales_bill_id = $1
           AND product_id = $2
         ORDER BY CASE WHEN ABS(COALESCE(selling_price, 0) - $3) < 0.01 THEN 0 ELSE 1 END,
                  id ASC`,
        [
          returnRow.original_bill_id,
          item.product_id,
          toNumber(item.original_price),
        ],
      );

      for (const billItem of billItemsRes.rows) {
        if (remainingQty <= 0) break;
        const allocations = parseBatchAllocations(billItem.batch_allocations);
        for (const allocation of allocations) {
          if (remainingQty <= 0) break;
          const allocationQty = toNumber(allocation.qty);
          const batchId = Number(allocation.batchId || allocation.batch_id);
          if (!batchId || allocationQty <= 0) continue;

          const restoreQty = Math.min(remainingQty, allocationQty);
          const allocationCostPrice = toNumber(
            allocation.costPrice,
            toNumber(item.original_price),
          );
          const allocationMrp = toNumber(
            allocation.mrp,
            toNumber(billItem.mrp, toNumber(item.original_price)),
          );
          const allocationSellingPrice = toNumber(
            allocation.sellingPrice,
            toNumber(billItem.selling_price, toNumber(item.original_price)),
          );
          const stockInItemRes = await query(
            `INSERT INTO stock_in_items (
               stock_in_id, product_id, product_name, qty, cost_price, tax_value,
               batch_no, mfg_date, expiry_date, mrp, selling_price, meta, created_at
             )
             VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11::jsonb, NOW())
             RETURNING id`,
            [
              stockInId,
              item.product_id,
              item.product_name || "Product",
              restoreQty,
              allocationCostPrice,
              allocation.batchNo || allocation.batch_no || null,
              allocation.mfgDate || allocation.mfg_date || null,
              allocation.expiryDate || allocation.expiry_date || null,
              allocationMrp,
              allocationSellingPrice,
              JSON.stringify({
                source: "return-approval",
                returnId,
                originalBillId: returnRow.original_bill_id,
                originalBillItemId: billItem.id,
                sourceBatchId: batchId,
                costPrice: allocationCostPrice,
                mrp: allocationMrp,
                sellingPrice: allocationSellingPrice,
              }),
            ],
          );
          const restored = await restoreBatchStock(
            {
              query,
            },
            {
              batchId,
              productId: item.product_id,
              storeId: returnRow.store_id,
              qty: restoreQty,
              referenceType: "sales_return",
              referenceId: returnId,
              sourceItemId: stockInItemRes.rows[0]?.id,
              meta: {
                source: "return-approval",
                returnId,
                originalBillId: returnRow.original_bill_id,
                originalBillItemId: billItem.id,
                costPrice: allocationCostPrice,
                mrp: allocationMrp,
                sellingPrice: allocationSellingPrice,
              },
            },
          );
          if (restored) {
            remainingQty =
              Math.round((remainingQty - restoreQty) * 1000) / 1000;
          }
        }
      }

      if (remainingQty > 0) {
        const fallbackSellingPrice = toNumber(item.original_price);
        const stockInItemRes = await query(
          `INSERT INTO stock_in_items (
             stock_in_id, product_id, product_name, qty, cost_price, tax_value,
             batch_no, mrp, selling_price, meta, created_at
           )
           VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9::jsonb, NOW())
           RETURNING id`,
          [
            stockInId,
            item.product_id,
            item.product_name || "Product",
            remainingQty,
            fallbackSellingPrice,
            `RETURN-${returnId}-${item.product_id}`,
            fallbackSellingPrice,
            fallbackSellingPrice,
            JSON.stringify({
              source: "return-approval",
              returnId,
              originalBillId: returnRow.original_bill_id,
              fallback: true,
              costPrice: fallbackSellingPrice,
              mrp: fallbackSellingPrice,
              sellingPrice: fallbackSellingPrice,
            }),
          ],
        );
        await receiveBatchStock(
          {
            query,
          },
          {
            stockInId,
            stockInItemId: stockInItemRes.rows[0]?.id,
            productId: item.product_id,
            storeId: returnRow.store_id,
            qty: remainingQty,
            costPrice: fallbackSellingPrice,
            batchNo: `RETURN-${returnId}-${item.product_id}`,
            meta: {
              source: "return-approval",
              returnId,
              originalBillId: returnRow.original_bill_id,
              fallback: true,
              costPrice: fallbackSellingPrice,
              mrp: fallbackSellingPrice,
              sellingPrice: fallbackSellingPrice,
            },
          },
        );
      }
    }

    const approved = await query(
      `UPDATE sales_returns
       SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [auth.user.id, returnId],
    );

    return successResponse(approved.rows[0], "Return request approved");
  } catch (err) {
    console.error("Return review error:", err);
    return errorResponse(err.message);
  }
}
