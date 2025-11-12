/**
 * throttle.ts
 * Utility function to throttle function execution
 * Prevents a function from being called more than once within a specified time period
 */

/**
 * Creates a throttled version of a function that limits execution frequency
 * @param func - The function to throttle
 * @param delay - The minimum delay in milliseconds between executions
 * @returns A throttled version of the function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: number | null = null;
  let lastExecutionTime = 0;
  let pendingArgs: Parameters<T> | null = null;

  return function(this: any, ...args: Parameters<T>) {
    const currentTime = Date.now();
    const timeSinceLastExecution = currentTime - lastExecutionTime;
    const context = this;

    // Clear any existing timeout
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    // If enough time has passed, execute immediately
    if (timeSinceLastExecution >= delay) {
      lastExecutionTime = currentTime;
      func.apply(context, args);
    } else {
      // Otherwise, store the args and schedule execution
      pendingArgs = args;
      const remainingDelay = delay - timeSinceLastExecution;

      timeoutId = setTimeout(() => {
        if (pendingArgs !== null) {
          lastExecutionTime = Date.now();
          func.apply(context, pendingArgs);
          pendingArgs = null;
        }
        timeoutId = null;
      }, remainingDelay) as any;
    }
  };
}

/**
 * Creates a debounced version of a function that delays execution
 * until after a specified time has elapsed since the last call
 * @param func - The function to debounce
 * @param delay - The delay in milliseconds
 * @returns A debounced version of the function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: number | null = null;

  return function(this: any, ...args: Parameters<T>) {
    const context = this;

    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func.apply(context, args);
      timeoutId = null;
    }, delay) as any;
  };
}