'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/authz/require-permission';
import {
  createProductionOrder,
  transitionProductionOrderStatus,
} from '@/domain/production-orders/create-production-order';
import { releaseProductionOrder } from '@/domain/production-orders/release-production-order';
import { assignProductionOrder } from '@/domain/production-orders/assign-production-order';
import type { ProductionOrderStatus } from '@/domain/production-orders/production-order-status';

export async function createProductionOrderAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  // The plan picker submits "productId:planRevisionId" as one value — see
  // the comment in projects/[id]/orders/new. Both halves are re-validated
  // against each other server-side, so a tampered value is rejected there.
  const [productId = '', productionPlanRevisionId = ''] = String(
    formData.get('planSelection'),
  ).split(':');

  const order = await createProductionOrder({
    actor,
    projectId: String(formData.get('projectId')),
    productId,
    productionPlanRevisionId,
    orderNumber: String(formData.get('orderNumber')),
    quantity: Number(formData.get('quantity')) || 1,
    serialNumber: (formData.get('serialNumber') as string) || undefined,
    batchNumber: (formData.get('batchNumber') as string) || undefined,
  });
  redirect(`/production-orders/${order.id}`);
}

export async function transitionProductionOrderStatusAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const productionOrderId = String(formData.get('productionOrderId'));
  await transitionProductionOrderStatus({
    actor,
    productionOrderId,
    toStatus: String(formData.get('toStatus')) as ProductionOrderStatus,
    expectedVersion: Number(formData.get('expectedVersion')),
  });
  revalidatePath(`/production-orders/${productionOrderId}`);
}

export async function releaseProductionOrderAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const productionOrderId = String(formData.get('productionOrderId'));
  await releaseProductionOrder({
    actor,
    productionOrderId,
    expectedVersion: Number(formData.get('expectedVersion')),
  });
  revalidatePath(`/production-orders/${productionOrderId}`);
}

export async function assignProductionOrderAction(formData: FormData): Promise<void> {
  const actor = await requireAuthContext();
  const productionOrderId = String(formData.get('productionOrderId'));
  await assignProductionOrder({
    actor,
    productionOrderId,
    userId: String(formData.get('userId')),
    role: (formData.get('role') as string) || undefined,
  });
  revalidatePath(`/production-orders/${productionOrderId}`);
}
