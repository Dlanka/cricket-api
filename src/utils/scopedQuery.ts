import type { FilterQuery, Model, UpdateQuery } from 'mongoose';

const withTenant = <T>(tenantId: string, filter: FilterQuery<T>): FilterQuery<T> => ({
  ...(filter ?? {}),
  tenantId
});

export const scopedFind = <T>(model: Model<T>, tenantId: string, filter: FilterQuery<T> = {}) =>
  model.find(withTenant(tenantId, filter));

export const scopedFindOne = <T>(model: Model<T>, tenantId: string, filter: FilterQuery<T> = {}) =>
  model.findOne(withTenant(tenantId, filter));

export const scopedUpdateOne = <T>(
  model: Model<T>,
  tenantId: string,
  filter: FilterQuery<T> = {},
  update: UpdateQuery<T>
) => model.updateOne(withTenant(tenantId, filter), update);

export const scopedDeleteOne = <T>(model: Model<T>, tenantId: string, filter: FilterQuery<T> = {}) =>
  model.deleteOne(withTenant(tenantId, filter));

export const scopedDeleteMany = <T>(
  model: Model<T>,
  tenantId: string,
  filter: FilterQuery<T> = {}
) => model.deleteMany(withTenant(tenantId, filter));
