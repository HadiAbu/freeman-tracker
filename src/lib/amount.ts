/**
 * The largest share count, price, fee or limit the app accepts. Far above anything real, and small
 * enough that sums and percentages cannot overflow to infinity. The API enforces the same value
 * (MAX_AMOUNT in api/app/models.py).
 */
export const MAX_AMOUNT = 1e12;

export const TOO_LARGE_MESSAGE = 'That number is too large';
