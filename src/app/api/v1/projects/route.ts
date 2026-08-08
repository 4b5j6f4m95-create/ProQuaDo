import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { createProject } from '@/domain/projects/create-project';
import { listProjects } from '@/domain/projects/project-queries';

const createProjectSchema = z.object({
  siteId: z.string().uuid(),
  projectNumber: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  customerId: z.string().uuid(),
  customerOrderNumber: z.string().max(100).optional(),
  description: z.string().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  plannedStartDate: z.coerce.date().optional(),
  plannedEndDate: z.coerce.date().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = createProjectSchema.parse(await request.json());
    const project = await createProject({ actor, ...body });
    return NextResponse.json(project, { status: 201 });
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const status = new URL(request.url).searchParams.get('status') ?? undefined;
    const projects = await listProjects(actor, { status });
    return NextResponse.json(projects);
  });
}
