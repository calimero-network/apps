export function parseErrorMessage(errorMessage: string | number[]): string {
  if (typeof errorMessage === 'string') {
    // Look for array pattern in the string (e.g., "[34, 65, ...]")
    const arrayMatch = errorMessage.match(/\[([\d,\s]+)\]/);
    if (arrayMatch) {
      try {
        const arrayString = arrayMatch[1];
        const numberArray = arrayString.split(',').map(num => parseInt(num.trim()));
        
        const messageData = new Uint8Array(numberArray);
        return new TextDecoder().decode(messageData);
      } catch (error) {
        console.error('Failed to parse array from string:', error);
        return errorMessage;
      }
    }
    return errorMessage;
  }

  if (Array.isArray(errorMessage)) {
    try {
      const messageData = new Uint8Array(errorMessage);
      return new TextDecoder().decode(messageData);
    } catch (error) {
      console.error('Failed to parse error message:', error);
      return 'An unknown error occurred';
    }
  }

  return 'An unknown error occurred';
}

export function extractErrorMessage(error: unknown): string {
  if (!error) {
    return 'An unknown error occurred';
  }

  if (typeof error === 'object' && error !== null) {
    const errorObj = error as Record<string, unknown>;
    
    if (errorObj.message && (typeof errorObj.message === 'string' || Array.isArray(errorObj.message))) {
      return parseErrorMessage(errorObj.message as string | number[]);
    }

    if (errorObj.error && (typeof errorObj.error === 'string' || Array.isArray(errorObj.error))) {
      return parseErrorMessage(errorObj.error as string | number[]);
    }
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unknown error occurred';
} 