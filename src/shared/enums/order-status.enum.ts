export enum OrderStatus {
  OPEN = 'open', // Đang chờ khớp
  PARTIALLY_FILLED = 'partially_filled', // Đã khớp một phần
  FILLED = 'filled', // Đã khớp hoàn toàn
  CANCELED = 'canceled', // Đã bị hủy
}
