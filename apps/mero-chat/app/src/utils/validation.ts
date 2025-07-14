export const isValidChannelName = (value: string) => {
  const regex = /^[^#!\s]{3,19}$/;
  let error = null;
  const isValid = regex.test(value);

  if (value.match(/[!#.\s]/)) {
    error = "Channel name must not contain special charters or links.";
  } else if (value.length < 3) {
    error = "Channel name is too short. It should be at least 3 characters.";
  } else if (value.length > 19) {
    error = "Channel name is too long. It should be at most 19 characters.";
  } else {
    error = "Invalid channel name.";
  }

  return { isValid, error };
};

/**
 * Validates a UserId/public key format
 * UserId is a 32-byte ID encoded as base58, resulting in 44 characters
 * This matches the Rust definition: UserId<32, 44>
 * 
 * @param value - The string to validate
 * @returns Object with isValid boolean and error message
 */
export const validateUserId = (value: string): { isValid: boolean; error: string } => {
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{44}$/;
  
  if (!value.trim()) {
    return {
      isValid: false,
      error: "Please enter a valid public key"
    };
  }
  
  if (!base58Regex.test(value)) {
    return {
      isValid: false,
      error: "Public key must be exactly 44 characters long and contain only base58 characters (1-9, A-H, J-N, P-Z, a-k, m-z)"
    };
  }
  
  return {
    isValid: true,
    error: ""
  };
};

/**
 * Checks if a string is a valid UserId format without returning error details
 * @param value - The string to validate
 * @returns boolean indicating if the value is a valid UserId
 */
export const isValidUserId = (value: string): boolean => {
  return validateUserId(value).isValid;
};
