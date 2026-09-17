---
kind: reference
topics: [react-query, optimistic mutation update]
aliases: [optimistic updates]
status: stable
---
# Mutations

## Optimistic updates

Apply an optimistic mutation update to the cached resource, then roll back on error.

```ts
useMutation({ onMutate: optimisticUpdate, onError: rollback });
```

## Basic mutations

Use useMutation for create, update, and delete requests.

