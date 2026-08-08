// Pure graph algorithm — no DB access — so it can be exhaustively unit- and
// property-tested (docs/09_TEST_PYRAMID.md "Ebene 2: Property-/Model-based
// Tests" + Negativtest #15: "Plan mit Zyklus freigeben: Validierungsfehler").
// Called by src/domain/production-plans/plan-review-workflow.ts as a guard
// before a plan revision may leave DRAFT.

export interface PlanStepEdge {
  dependentStepId: string;
  predecessorStepId: string;
}

export interface PlanGraphValidationResult {
  valid: boolean;
  /** The step IDs forming a cycle, in traversal order, present only when invalid. */
  cycleStepIds?: string[];
}

const WHITE = 0;
const GRAY = 1;
const BLACK = 2;

export function validatePlanGraph(
  stepIds: readonly string[],
  edges: readonly PlanStepEdge[],
): PlanGraphValidationResult {
  const adjacency = new Map<string, string[]>();
  for (const id of stepIds) adjacency.set(id, []);
  for (const edge of edges) {
    adjacency.get(edge.predecessorStepId)?.push(edge.dependentStepId);
  }

  const color = new Map<string, number>(stepIds.map((id) => [id, WHITE]));
  const pathStack: string[] = [];

  function dfs(node: string): string[] | null {
    color.set(node, GRAY);
    pathStack.push(node);

    for (const next of adjacency.get(node) ?? []) {
      if (color.get(next) === GRAY) {
        const cycleStart = pathStack.indexOf(next);
        return [...pathStack.slice(cycleStart), next];
      }
      if (color.get(next) === WHITE) {
        const found = dfs(next);
        if (found) return found;
      }
    }

    pathStack.pop();
    color.set(node, BLACK);
    return null;
  }

  for (const id of stepIds) {
    if (color.get(id) === WHITE) {
      const cycle = dfs(id);
      if (cycle) return { valid: false, cycleStepIds: cycle };
    }
  }

  return { valid: true };
}
