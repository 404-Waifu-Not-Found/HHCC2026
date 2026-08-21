export function createInitialOrdering(
  length: number,
  random = Math.random,
): number[] {
  const order = Array.from({ length }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [order[index], order[other]] = [order[other]!, order[index]!];
  }
  if (length > 1 && order.every((value, index) => value === index))
    order.push(order.shift()!);
  return order;
}

export type ChoicePresentation = {
  options: string[];
  displayToCanonical: number[];
};

export function createChoicePresentation(
  canonicalOptions: readonly string[],
  randomUint32 = secureRandomUint32,
): ChoicePresentation {
  const displayToCanonical = canonicalOptions.map((_, index) => index);
  for (let index = displayToCanonical.length - 1; index > 0; index -= 1) {
    const other = unbiasedRandomIndex(index + 1, randomUint32);
    [displayToCanonical[index], displayToCanonical[other]] = [
      displayToCanonical[other]!,
      displayToCanonical[index]!,
    ];
  }
  return {
    options: displayToCanonical.map((index) => canonicalOptions[index]!),
    displayToCanonical,
  };
}

function secureRandomUint32(): number {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0]!;
  }
  return Math.floor(Math.random() * 0x1_0000_0000);
}

function unbiasedRandomIndex(
  maximumExclusive: number,
  randomUint32: () => number,
): number {
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / maximumExclusive) * maximumExclusive;
  let value: number;
  do value = randomUint32() >>> 0;
  while (value >= limit);
  return value % maximumExclusive;
}
