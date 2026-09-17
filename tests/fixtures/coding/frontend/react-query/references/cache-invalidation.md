---
id: frontend/react-query/cache-invalidation
name: frontend/react-query/cache-invalidation
kind: reference
domain: frontend
topics: [react-query, cache invalidation]
aliases: [stale cache, invalidate query, invalidateQueries]
priority: medium
status: stable
canonical: true
---
# Cache Invalidation

## Rules

Invalidate cache after updating a resource. Invalidate both list and individual queries after a successful mutation.

## Examples

### Updating resources

```typescript
const queryClient = useQueryClient();
onSuccess: updatedCourse => {
  queryClient.invalidateQueries({ queryKey: ['courses'] });
  queryClient.invalidateQueries({ queryKey: ['courses', updatedCourse.id] });
};
```

## Notes

### Selective Invalidation

Use exact matching to invalidate query keys. Use a predicate for selective invalidation.

