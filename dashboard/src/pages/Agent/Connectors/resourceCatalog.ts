export type ResourceKind = "expert" | "skill" | "connector";

export interface UnifiedResource<T = unknown> {
  key: string;
  kind: ResourceKind;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  statusLabel?: string;
  item?: T;
}

export function filterAndSortResources<T>(
  resources: readonly UnifiedResource<T>[],
  query: string,
  kind: ResourceKind | "all",
): UnifiedResource<T>[] {
  const needle = query.trim().toLocaleLowerCase();
  return resources
    .map((resource, index) => ({ resource, index }))
    .filter(({ resource }) => {
      if (kind !== "all" && resource.kind !== kind) return false;
      if (!needle) return true;
      return [resource.name, resource.description, resource.category].some(
        (part) => part.toLocaleLowerCase().includes(needle),
      );
    })
    .sort(
      (a, b) =>
        Number(b.resource.enabled) - Number(a.resource.enabled) ||
        a.index - b.index,
    )
    .map(({ resource }) => resource);
}
