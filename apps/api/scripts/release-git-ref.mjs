export function pushedReferenceForHead(branch) {
  if (typeof branch !== "string") {
    throw new TypeError("Git branch must be a string.");
  }
  return branch.trim() ? "@{upstream}" : "origin/main";
}
