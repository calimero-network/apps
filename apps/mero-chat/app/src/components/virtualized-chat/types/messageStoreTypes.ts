export interface UpdateFunction<T> {
  (currentMessage: T): Partial<T>;
}
export type UpdateDescriptor<T> =
  | { updatedFields: Partial<T> }
  | { updateFunction: UpdateFunction<T> };
