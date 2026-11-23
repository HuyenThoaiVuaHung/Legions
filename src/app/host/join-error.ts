import { HttpErrorResponse } from '@angular/common/http';

export function joinError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'Không thể kết nối tới máy chủ.';
  if (error.status === 400) return 'Thông tin vào phòng không hợp lệ.';
  if (error.status === 401) return 'Mật mã hoặc liên kết không đúng, đã hết hạn hoặc phòng yêu cầu mật mã khán giả.';
  if (error.status === 403) return 'Phòng không cho phép khán giả tham gia.';
  if (error.status === 404) return 'Không tìm thấy phòng với mã này.';
  if (error.status === 429) return 'Quá nhiều lần thử. Vui lòng thử lại sau.';
  return 'Không thể vào phòng. Vui lòng thử lại.';
}
