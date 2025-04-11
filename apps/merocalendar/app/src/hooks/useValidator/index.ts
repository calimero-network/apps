import { useState } from 'react'
import { IDataForCheck, IErrorsMessages, IRules, IValidationResponse } from './types';
import { validationMethods } from '../../utils/validations';

export const useValidator = <DefaultFields extends Object>() => {
  const [errors, setErrors] = useState<IErrorsMessages<DefaultFields>>({});

  const validate = (fields: DefaultFields, rules: IRules = {}) => {
    const errorsMessages: IErrorsMessages<DefaultFields> = {};
    for (const keyRule in rules) {
      const fieldRules = rules[keyRule];
      // @ts-ignore
      const messageError = checkField({ fieldRules, value: fields[keyRule], fields });

      if (typeof messageError === 'string') {
         // @ts-ignore
        errorsMessages[keyRule] = messageError;
      }
    }
    setErrors(errorsMessages);
    return errorsMessages;
  }

  const checkField = ({ fieldRules, value, fields }: IDataForCheck<DefaultFields>) => {
    let checkRole: IValidationResponse;
    for (const role in fieldRules) {
       // @ts-ignore
      const parameter = fieldRules[role];

      if (typeof parameter === 'string') {
         // @ts-ignore
        checkRole = validationMethods[role](value, fields?.[parameter]);
      }
      if (typeof parameter === 'number') {
         // @ts-ignore
        checkRole = validationMethods[role](value.toString(), parameter);
      }
      if (typeof parameter === 'boolean') {
         // @ts-ignore
        checkRole = validationMethods[role](value.toString());
      }
  
       // @ts-ignore
      if (!checkRole.status) {
        break;
      }
    }

    // @ts-ignore
    return checkRole?.errorMessage
  }

  const fails = (errorsMessage?: IErrorsMessages<DefaultFields>) => {
    if (errorsMessage !== undefined) {
      return (Object.values(errorsMessage).length === 0) ? { status: true } : { status: false, messages: errorsMessage };
    }
    return (Object.values(errors).length === 0) ? { status: true } : { status: false, messages: errors };
  }

  return { errors, validate, checkField, fails, setErrors };
}