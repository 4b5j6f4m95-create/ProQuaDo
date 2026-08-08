import { validatePlanGraph, type PlanStepEdge } from '../plan-graph';

describe('validatePlanGraph', () => {
  it('accepts an empty graph', () => {
    expect(validatePlanGraph([], [])).toEqual({ valid: true });
  });

  it('accepts a graph with steps but no dependencies', () => {
    expect(validatePlanGraph(['a', 'b', 'c'], [])).toEqual({ valid: true });
  });

  it('accepts a simple linear chain', () => {
    const edges: PlanStepEdge[] = [
      { predecessorStepId: 'a', dependentStepId: 'b' },
      { predecessorStepId: 'b', dependentStepId: 'c' },
    ];
    expect(validatePlanGraph(['a', 'b', 'c'], edges)).toEqual({ valid: true });
  });

  it('accepts a diamond (parallel branches joining)', () => {
    // a -> b -> d
    // a -> c -> d
    const edges: PlanStepEdge[] = [
      { predecessorStepId: 'a', dependentStepId: 'b' },
      { predecessorStepId: 'a', dependentStepId: 'c' },
      { predecessorStepId: 'b', dependentStepId: 'd' },
      { predecessorStepId: 'c', dependentStepId: 'd' },
    ];
    expect(validatePlanGraph(['a', 'b', 'c', 'd'], edges).valid).toBe(true);
  });

  it('rejects a direct self-cycle (a depends on a)', () => {
    const result = validatePlanGraph(['a'], [{ predecessorStepId: 'a', dependentStepId: 'a' }]);
    expect(result.valid).toBe(false);
    expect(result.cycleStepIds).toEqual(['a', 'a']);
  });

  it('Negativtest #15 analog: rejects a three-step cycle (a -> b -> c -> a)', () => {
    const edges: PlanStepEdge[] = [
      { predecessorStepId: 'a', dependentStepId: 'b' },
      { predecessorStepId: 'b', dependentStepId: 'c' },
      { predecessorStepId: 'c', dependentStepId: 'a' },
    ];
    const result = validatePlanGraph(['a', 'b', 'c'], edges);
    expect(result.valid).toBe(false);
    expect(result.cycleStepIds).toContain('a');
    expect(result.cycleStepIds).toContain('b');
    expect(result.cycleStepIds).toContain('c');
  });

  it('rejects a cycle hidden behind an otherwise-valid branch', () => {
    // a -> b (fine), b -> c -> d -> b (cycle)
    const edges: PlanStepEdge[] = [
      { predecessorStepId: 'a', dependentStepId: 'b' },
      { predecessorStepId: 'b', dependentStepId: 'c' },
      { predecessorStepId: 'c', dependentStepId: 'd' },
      { predecessorStepId: 'd', dependentStepId: 'b' },
    ];
    expect(validatePlanGraph(['a', 'b', 'c', 'd'], edges).valid).toBe(false);
  });

  it('detects a cycle regardless of step iteration order', () => {
    const edges: PlanStepEdge[] = [
      { predecessorStepId: 'x', dependentStepId: 'y' },
      { predecessorStepId: 'y', dependentStepId: 'x' },
    ];
    expect(validatePlanGraph(['y', 'x'], edges).valid).toBe(false);
    expect(validatePlanGraph(['x', 'y'], edges).valid).toBe(false);
  });

  it('property-style: every generated acyclic layered graph validates as valid', () => {
    // Build 5 layers of 3 nodes each; edges only ever point from a lower
    // layer to a higher layer, which is structurally guaranteed acyclic.
    const layers = Array.from({ length: 5 }, (_, layer) =>
      Array.from({ length: 3 }, (_, i) => `L${layer}N${i}`),
    );
    const stepIds = layers.flat();
    const edges: PlanStepEdge[] = [];
    for (let layer = 0; layer < layers.length - 1; layer++) {
      for (const from of layers[layer]!) {
        for (const to of layers[layer + 1]!) {
          edges.push({ predecessorStepId: from, dependentStepId: to });
        }
      }
    }
    expect(validatePlanGraph(stepIds, edges)).toEqual({ valid: true });
  });

  it('property-style: adding one back-edge to an acyclic layered graph always introduces a cycle', () => {
    const layers = Array.from({ length: 4 }, (_, layer) =>
      Array.from({ length: 2 }, (_, i) => `L${layer}N${i}`),
    );
    const stepIds = layers.flat();
    const forwardEdges: PlanStepEdge[] = [];
    for (let layer = 0; layer < layers.length - 1; layer++) {
      forwardEdges.push({
        predecessorStepId: layers[layer]![0]!,
        dependentStepId: layers[layer + 1]![0]!,
      });
    }
    // Back-edge from the last layer's node to the first layer's node.
    const backEdge: PlanStepEdge = {
      predecessorStepId: layers[layers.length - 1]![0]!,
      dependentStepId: layers[0]![0]!,
    };
    expect(validatePlanGraph(stepIds, [...forwardEdges, backEdge]).valid).toBe(false);
  });
});
