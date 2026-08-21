export function createInitialOrdering(length: number, random = Math.random): number[] {
  const order = Array.from({ length }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [order[index], order[other]] = [order[other]!, order[index]!];
  }
  if (length > 1 && order.every((value, index) => value === index)) order.push(order.shift()!);
  return order;
}
