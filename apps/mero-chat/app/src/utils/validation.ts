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

