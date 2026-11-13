const senderColors = new Map([
  ['owner', '#ff0'],
  ['friendly', '#3f7'],
  ['admin', '#4df'],
  ['hostile', '#f44'],
]);

export const senderColor = (role: string, own = false) =>
  own && !['admin', 'owner'].includes(role)
    ? '#e6f'
    : senderColors.get(role) || '#fff';
