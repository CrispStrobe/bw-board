/** Ordinary order-control only; artifact verification and floor policy stay unchanged. */
export function comparisonOrder(reverse = false) {
    return reverse ? ['candidate', 'baseline', 'baseline', 'candidate']
        : ['baseline', 'candidate', 'candidate', 'baseline'];
}
