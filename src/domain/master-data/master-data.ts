import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError, ValidationError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';

/**
 * Standorte, Kunden und Produkte anlegen.
 *
 * ## Warum es das erst jetzt gibt
 *
 * Bis hierher entstanden alle drei ausschließlich im Seed, mit fest
 * verdrahteten Demo-Werten — es gab weder Dienst noch Route noch Formular.
 * Solange eine Datenmigration aus einem Altsystem eingeplant war, fiel das
 * nicht auf: docs/10 führt sie als „**falls Altsystem vorhanden**" und stellt
 * die andere Hälfte der Frage nie. Ohne Altsystem steht ein Pilot damit vor
 * einem Projektformular, dessen Auswahllisten für Standort und Kunde leer
 * sind.
 *
 * ## Die Reihenfolge, die daraus folgt
 *
 * Organisation → **Standort** → **Kunde** → Projekt → **Produkt** → Plan →
 * Auftrag. Das Produkt hängt am Projekt (`products.project_id`), ist also
 * kein organisationsweiter Stammsatz — es entsteht dort, wo die
 * Projektleitung ohnehin arbeitet, und trägt deshalb `product.manage` statt
 * eines Administrationsrechts.
 *
 * ## Warum jede Funktion vorher nachsieht
 *
 * Die Eindeutigkeit steht als Constraint in der Datenbank und bleibt dort —
 * sie ist die Wahrheit. Die Prüfung davor existiert nur, damit aus einer
 * doppelten Standortnummer eine lesbare Meldung wird statt eines 500ers.
 * Dieselbe Bauart wie bei den Webhook-Abonnements.
 */

export interface CreateSiteCommand {
  actor: Actor;
  code: string;
  name: string;
  location?: string;
  timezone?: string;
}

export async function createSite(command: CreateSiteCommand) {
  await assertPermission(command.actor, 'site.manage');
  const code = command.code.trim();
  const name = command.name.trim();
  if (!code || !name) throw new ValidationError('Standortkürzel und Name sind erforderlich.');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const existing = await tx.site.findFirst({ where: { code } });
    if (existing) {
      throw new ValidationError(`Ein Standort mit dem Kürzel „${code}" existiert bereits.`);
    }

    const site = await tx.site.create({
      data: {
        organizationId: command.actor.organizationId,
        code,
        name,
        location: command.location?.trim() || undefined,
        // Die Zeitzone steht am Standort, weil eine Schicht dort stattfindet
        // und nicht dort, wo der Server läuft. Vorgabe wie im Schema.
        timezone: command.timezone?.trim() || 'UTC',
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'site.created',
      resourceType: 'site',
      resourceId: site.id,
      actorId: command.actor.userId,
      newValues: { code: site.code, name: site.name },
      source: 'web',
    });

    return site;
  });
}

export interface CreateDepartmentCommand {
  actor: Actor;
  siteId: string;
  name: string;
  code?: string;
  description?: string;
}

/**
 * Abteilung an einem Standort.
 *
 * Trägt `site.manage` und kein eigenes Atom: eine Abteilung ist eine
 * Untergliederung des Standorts, keine eigene Art von Stammdatum. Ein
 * zusätzliches Atom hätte die Matrix verlängert, ohne eine Entscheidung
 * abzubilden, die jemand anders treffen würde.
 */
export async function createDepartment(command: CreateDepartmentCommand) {
  await assertPermission(command.actor, 'site.manage');
  const name = command.name.trim();
  const code = command.code?.trim() || undefined;
  if (!name) throw new ValidationError('Der Name der Abteilung ist erforderlich.');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const site = await tx.site.findFirst({ where: { id: command.siteId } });
    if (!site) throw new NotFoundError('Standort');

    // Je Standort eindeutig — zwei Werke dürfen beide eine Montage haben.
    const sameName = await tx.department.findFirst({ where: { siteId: site.id, name } });
    if (sameName) {
      throw new ValidationError(`Am Standort ${site.name} gibt es „${name}" bereits.`);
    }
    if (code) {
      const sameCode = await tx.department.findFirst({ where: { code } });
      if (sameCode) {
        throw new ValidationError(`Das Kürzel „${code}" ist bereits vergeben.`);
      }
    }

    const department = await tx.department.create({
      data: {
        organizationId: command.actor.organizationId,
        siteId: site.id,
        name,
        code,
        description: command.description?.trim() || undefined,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'department.created',
      resourceType: 'department',
      resourceId: department.id,
      actorId: command.actor.userId,
      newValues: { name: department.name, code: department.code, siteId: site.id },
      source: 'web',
    });

    return department;
  });
}

export interface CreateWorkCenterCommand {
  actor: Actor;
  departmentId: string;
  name: string;
  description?: string;
  equipmentRef?: string;
}

/**
 * Arbeitsplatz in einer Abteilung — die feinste Ebene, auf die ein Planschritt
 * verweisen kann (beides dort optional).
 */
export async function createWorkCenter(command: CreateWorkCenterCommand) {
  await assertPermission(command.actor, 'site.manage');
  const name = command.name.trim();
  if (!name) throw new ValidationError('Der Name des Arbeitsplatzes ist erforderlich.');

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const department = await tx.department.findFirst({ where: { id: command.departmentId } });
    if (!department) throw new NotFoundError('Abteilung');

    // Je Abteilung eindeutig — „Prüfplatz 1" darf es in jeder geben.
    const existing = await tx.workCenter.findFirst({
      where: { departmentId: department.id, name },
    });
    if (existing) {
      throw new ValidationError(`In der Abteilung ${department.name} gibt es „${name}" bereits.`);
    }

    const workCenter = await tx.workCenter.create({
      data: {
        organizationId: command.actor.organizationId,
        departmentId: department.id,
        name,
        description: command.description?.trim() || undefined,
        equipmentRef: command.equipmentRef?.trim() || undefined,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'work_center.created',
      resourceType: 'work_center',
      resourceId: workCenter.id,
      actorId: command.actor.userId,
      newValues: { name: workCenter.name, departmentId: department.id },
      source: 'web',
    });

    return workCenter;
  });
}

export interface CreateCustomerCommand {
  actor: Actor;
  customerNumber: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}

export async function createCustomer(command: CreateCustomerCommand) {
  await assertPermission(command.actor, 'customer.manage');
  const customerNumber = command.customerNumber.trim();
  const name = command.name.trim();
  if (!customerNumber || !name) {
    throw new ValidationError('Kundennummer und Name sind erforderlich.');
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const existing = await tx.customer.findFirst({ where: { customerNumber } });
    if (existing) {
      throw new ValidationError(`Ein Kunde mit der Nummer „${customerNumber}" existiert bereits.`);
    }

    const customer = await tx.customer.create({
      data: {
        organizationId: command.actor.organizationId,
        customerNumber,
        name,
        email: command.email?.trim() || undefined,
        phone: command.phone?.trim() || undefined,
        address: command.address?.trim() || undefined,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'customer.created',
      resourceType: 'customer',
      resourceId: customer.id,
      actorId: command.actor.userId,
      newValues: { customerNumber: customer.customerNumber, name: customer.name },
      source: 'web',
    });

    return customer;
  });
}

export interface CreateProductCommand {
  actor: Actor;
  projectId: string;
  productNumber: string;
  name: string;
  description?: string;
}

export async function createProduct(command: CreateProductCommand) {
  await assertPermission(command.actor, 'product.manage');
  const productNumber = command.productNumber.trim();
  const name = command.name.trim();
  if (!productNumber || !name) {
    throw new ValidationError('Produktnummer und Name sind erforderlich.');
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    // Das Projekt wird nachgeschlagen, nicht geglaubt: die Kennung kommt aus
    // dem Formular, und RLS begrenzt zwar auf die eigene Organisation, sagt
    // aber nichts darüber, ob es das Projekt gibt.
    const project = await tx.project.findFirst({ where: { id: command.projectId } });
    if (!project) throw new NotFoundError('Projekt');

    const existing = await tx.product.findFirst({ where: { productNumber } });
    if (existing) {
      throw new ValidationError(
        `Ein Produkt mit der Nummer „${productNumber}" existiert bereits — ` +
          'Produktnummern gelten organisationsweit, nicht je Projekt.',
      );
    }

    const product = await tx.product.create({
      data: {
        organizationId: command.actor.organizationId,
        projectId: project.id,
        productNumber,
        name,
        description: command.description?.trim() || undefined,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'product.created',
      resourceType: 'product',
      resourceId: product.id,
      actorId: command.actor.userId,
      newValues: { productNumber: product.productNumber, name: product.name },
      source: 'web',
    });

    return product;
  });
}
