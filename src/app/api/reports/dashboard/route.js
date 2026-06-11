import { requireAuth, requireRole } from '@/lib/api-protection';
import { successResponse, errorResponse } from '@/lib/api-response';
import { getLiveReportsDashboard } from '@/lib/reportsService';

export async function GET(request) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const roleCheck = requireRole(auth.user, 'super_admin', 'admin', 'manager');
    if (roleCheck.error) return roleCheck.error;

    const dashboard = await getLiveReportsDashboard(auth.user);
    return successResponse(dashboard);
  } catch (err) {
    console.error('[reports dashboard]', err);
    return errorResponse('Unable to load reports dashboard');
  }
}
