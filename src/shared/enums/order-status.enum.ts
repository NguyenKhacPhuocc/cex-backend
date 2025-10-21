export enum OrderStatus {
  OPEN = 'OPEN', // Đang chờ khớp
  PARTIALLY_FILLED = 'PARTIALLY_FILLED', // Đã khớp một phần
  FILLED = 'FILLED', // Đã khớp hoàn toàn
  CANCELED = 'CANCELED', // Đã bị hủy
}
