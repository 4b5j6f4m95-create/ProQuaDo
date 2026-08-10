'use server';

import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { createSite, createCustomer } from '@/domain/master-data/master-data';
import {
  inviteUser,
  assignRole,
  revokeRole,
  clearConfirmationPin,
} from '@/domain/identity/user-administration';
import { DomainError } from '@/lib/domain-errors';
import { AuthzError } from '@/lib/authz/errors';

export interface AdminFormState {
  error: string | null;
  result: string | null;
}

/**
 * Alle Aktionen dieses Bildschirms geben Fehler zurück, statt sie zu werfen.
 * „Die Kundennummer ist schon vergeben" ist eine normale Antwort mit einer
 * offensichtlichen nächsten Handlung — kein Seitenabbruch (notes.md, „Eine
 * geworfene Ablehnung reißt in Next.js die ganze Seite weg").
 */
async function guarded(work: () => Promise<string>): Promise<AdminFormState> {
  try {
    const result = await work();
    revalidatePath('/admin');
    return { error: null, result };
  } catch (error) {
    if (error instanceof DomainError || error instanceof AuthzError) {
      return { error: error.message, result: null };
    }
    throw error;
  }
}

export async function createSiteAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return guarded(async () => {
    const actor = await requireAuthContext();
    const site = await createSite({
      actor,
      code: String(formData.get('code') ?? ''),
      name: String(formData.get('name') ?? ''),
      location: String(formData.get('location') ?? '') || undefined,
      timezone: String(formData.get('timezone') ?? '') || undefined,
    });
    return `Standort ${site.code} angelegt.`;
  });
}

export async function createCustomerAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return guarded(async () => {
    const actor = await requireAuthContext();
    const customer = await createCustomer({
      actor,
      customerNumber: String(formData.get('customerNumber') ?? ''),
      name: String(formData.get('name') ?? ''),
      email: String(formData.get('email') ?? '') || undefined,
      phone: String(formData.get('phone') ?? '') || undefined,
      address: String(formData.get('address') ?? '') || undefined,
    });
    return `Kunde ${customer.customerNumber} angelegt.`;
  });
}

export async function inviteUserAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return guarded(async () => {
    const actor = await requireAuthContext();
    const user = await inviteUser({
      actor,
      email: String(formData.get('email') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
      employeeNumber: String(formData.get('employeeNumber') ?? ''),
      roleCode: String(formData.get('roleCode') ?? ''),
      siteId: String(formData.get('siteId') ?? '') || undefined,
    });
    return (
      `${user.email} eingeladen. Die Person muss sich einmal anmelden und ` +
      'anschließend unter „Mein Konto" ihre Bestätigungs-PIN setzen.'
    );
  });
}

export async function assignRoleAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return guarded(async () => {
    const actor = await requireAuthContext();
    const roleCode = String(formData.get('roleCode') ?? '');
    await assignRole({ actor, userId: String(formData.get('userId') ?? ''), roleCode });
    return `Rolle ${roleCode} zugewiesen.`;
  });
}

export async function revokeRoleAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return guarded(async () => {
    const actor = await requireAuthContext();
    const roleCode = String(formData.get('roleCode') ?? '');
    await revokeRole({ actor, userId: String(formData.get('userId') ?? ''), roleCode });
    return `Rolle ${roleCode} entzogen.`;
  });
}

export async function clearConfirmationPinAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  return guarded(async () => {
    const actor = await requireAuthContext();
    await clearConfirmationPin({
      actor,
      userId: String(formData.get('userId') ?? ''),
      reason: String(formData.get('reason') ?? ''),
    });
    return 'PIN gelöscht. Die Person setzt unter „Mein Konto" eine neue — eine PIN zu vergeben ist nicht möglich.';
  });
}
