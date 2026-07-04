import { api } from './client';

export const fetchPendingUsers = async () => {
  const response = await api.get('/users/pending');
  return response.data || { users: [] };
};

export const approveUserByAdmin = async (userId) => {
  const response = await api.patch(`/users/${userId}/approve`);
  return response.data || null;
};
