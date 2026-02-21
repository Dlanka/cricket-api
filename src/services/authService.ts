import bcrypt from 'bcrypt';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { Request } from 'express';
import { env } from '../config/env';
import { UserModel } from '../models/user';
import { TenantModel } from '../models/tenant';
import { MembershipModel } from '../models/membership';
import { AppError } from '../utils/appError';

const issueAccessToken = (payload: Record<string, unknown>) =>
  jwt.sign(payload, env.JWT_SECRET, { expiresIn: '12h' });

const issueLoginSessionToken = (payload: Record<string, unknown>) =>
  jwt.sign(payload, env.JWT_SECRET, { expiresIn: '5m' });

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const buildUserSummary = (user: { id: string; email: string; fullName: string }) => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName
});

const buildTenantSummary = (tenant: { id: string; name: string }) => ({
  id: tenant.id,
  name: tenant.name
});

const resolveTenantOwnerUserId = async (tenantId: string): Promise<string | null> => {
  const tenant = await TenantModel.findById(tenantId).select({ _id: 1, ownerUserId: 1 });
  if (!tenant) {
    return null;
  }

  if (tenant.ownerUserId) {
    return tenant.ownerUserId.toString();
  }

  const firstAdminMembership = await MembershipModel.findOne({
    tenantId,
    role: 'ADMIN',
    status: 'ACTIVE'
  })
    .sort({ createdAt: 1 })
    .select({ userId: 1 });

  if (!firstAdminMembership) {
    return null;
  }

  tenant.ownerUserId = firstAdminMembership.userId;
  await tenant.save();
  return firstAdminMembership.userId.toString();
};

export type LoginLoggedInResponse = {
  mode: 'LOGGED_IN';
  accessToken: string;
  user: { id: string; email: string; fullName: string };
  tenant: { id: string; name: string };
  role: string;
};

export type LoginSelectTenantResponse = {
  mode: 'SELECT_TENANT';
  loginSessionToken: string;
  tenants: { tenantId: string; tenantName: string; role: string }[];
};

export type LoginResponse = LoginLoggedInResponse | LoginSelectTenantResponse;

export type SignupInput = {
  email: string;
  password: string;
  fullName: string;
  tenantName: string;
};

export const loginWithPassword = async (email: string, password: string): Promise<LoginResponse> => {
  const user = await UserModel.findOne({ email: normalizeEmail(email) });

  if (!user) {
    throw new AppError('Invalid email or password.', 401, 'auth.invalid_credentials');
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);

  if (!isValid) {
    throw new AppError('Invalid email or password.', 401, 'auth.invalid_credentials');
  }

  const memberships = await MembershipModel.find({
    userId: user._id,
    status: 'ACTIVE'
  }).populate('tenantId');

  const activeMemberships = memberships.filter((membership) => {
    const tenant = membership.tenantId as unknown as { status?: string } | null;
    return tenant?.status === 'ACTIVE';
  });

  if (activeMemberships.length === 0) {
    throw new AppError('No active tenant memberships found.', 403, 'auth.no_active_membership');
  }

  if (activeMemberships.length === 1) {
    const membership = activeMemberships[0];
    const tenant = membership.tenantId as unknown as { _id: string; name: string };
    const userId = user._id.toString();
    const tenantId = tenant._id.toString();
    const role = membership.role;

    const accessToken = issueAccessToken({
      sub: userId,
      userId,
      tenantId,
      role,
      scope: 'app'
    });

    return {
      mode: 'LOGGED_IN',
      accessToken,
      user: buildUserSummary({ id: userId, email: user.email, fullName: user.fullName }),
      tenant: buildTenantSummary({ id: tenantId, name: tenant.name }),
      role
    };
  }

  const loginSessionToken = issueLoginSessionToken({
    sub: user._id.toString(),
    userId: user._id.toString(),
    scope: 'tenant_select'
  });

  return {
    mode: 'SELECT_TENANT',
    loginSessionToken,
    tenants: activeMemberships.map((membership) => {
      const tenant = membership.tenantId as unknown as { _id: string; name: string };
      return {
        tenantId: tenant._id.toString(),
        tenantName: tenant.name,
        role: membership.role
      };
    })
  };
};

export const signupWithPassword = async (input: SignupInput): Promise<LoginLoggedInResponse> => {
  const email = normalizeEmail(input.email);

  const existingUser = await UserModel.findOne({ email }).select({ _id: 1 });
  if (existingUser) {
    throw new AppError('Email already registered.', 409, 'auth.email_already_exists');
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await UserModel.create({
    email,
    passwordHash,
    fullName: input.fullName.trim(),
    status: 'ACTIVE'
  });

  const tenant = await TenantModel.create({
    name: input.tenantName.trim(),
    status: 'ACTIVE',
    ownerUserId: user._id
  });

  await MembershipModel.create({
    userId: user._id,
    tenantId: tenant._id,
    role: 'ADMIN',
    status: 'ACTIVE'
  });

  const userId = user._id.toString();
  const tenantId = tenant._id.toString();

  const accessToken = issueAccessToken({
    sub: userId,
    userId,
    tenantId,
    role: 'ADMIN',
    scope: 'app'
  });

  return {
    mode: 'LOGGED_IN',
    accessToken,
    user: buildUserSummary({ id: userId, email: user.email, fullName: user.fullName }),
    tenant: buildTenantSummary({ id: tenantId, name: tenant.name }),
    role: 'ADMIN'
  };
};

export const selectTenantSession = async (
  loginSessionToken: string,
  tenantId: string
): Promise<LoginLoggedInResponse> => {
  let payload: JwtPayload;

  try {
    payload = jwt.verify(loginSessionToken, env.JWT_SECRET) as JwtPayload;
  } catch (error) {
    throw new AppError('Invalid or expired login session.', 401, 'auth.invalid_login_session');
  }

  if (payload.scope !== 'tenant_select') {
    throw new AppError('Invalid login session scope.', 403, 'auth.invalid_scope');
  }

  const userId = (payload.sub as string | undefined) ?? (payload.userId as string | undefined);

  if (!userId) {
    throw new AppError('Invalid login session payload.', 401, 'auth.invalid_login_session');
  }

  const membership = await MembershipModel.findOne({
    userId,
    tenantId,
    status: 'ACTIVE'
  }).populate('tenantId');

  if (!membership) {
    throw new AppError('No active membership for tenant.', 403, 'auth.membership_not_found');
  }

  const tenant = membership.tenantId as unknown as { _id: string; name: string; status: string } | null;

  if (!tenant || tenant.status !== 'ACTIVE') {
    throw new AppError('Tenant is not active.', 403, 'auth.tenant_inactive');
  }

  const user = await UserModel.findById(userId);

  if (!user) {
    throw new AppError('User not found.', 404, 'auth.user_not_found');
  }

  const accessToken = issueAccessToken({
    sub: userId,
    userId,
    tenantId: tenant._id.toString(),
    role: membership.role,
    scope: 'app'
  });

  return {
    mode: 'LOGGED_IN',
    accessToken,
    user: buildUserSummary({ id: userId, email: user.email, fullName: user.fullName }),
    tenant: buildTenantSummary({ id: tenant._id.toString(), name: tenant.name }),
    role: membership.role
  };
};

export const getMeFromToken = async (req: Request) => {
  const tokenPayload = req.tokenPayload as JwtPayload | undefined;

  if (!tokenPayload) {
    throw new AppError('Authentication token missing.', 401, 'auth.missing_token');
  }

  if (tokenPayload.scope !== 'app') {
    throw new AppError('Invalid token scope.', 403, 'auth.invalid_scope');
  }

  const userId = (tokenPayload.sub as string | undefined) ?? (tokenPayload.userId as string | undefined);
  const tenantId = tokenPayload.tenantId as string | undefined;
  const role = tokenPayload.role as string | undefined;

  if (!userId || !tenantId || !role) {
    throw new AppError('Invalid token payload.', 401, 'auth.invalid_token');
  }

  const [user, tenant, ownerUserId] = await Promise.all([
    UserModel.findById(userId),
    TenantModel.findById(tenantId),
    resolveTenantOwnerUserId(tenantId)
  ]);

  if (!user || !tenant) {
    throw new AppError('User or tenant not found.', 404, 'auth.subject_not_found');
  }

  return {
    user: buildUserSummary({ id: userId, email: user.email, fullName: user.fullName }),
    tenant: buildTenantSummary({ id: tenantId, name: tenant.name }),
    role,
    isOwner: ownerUserId !== null && ownerUserId === userId
  };
};
