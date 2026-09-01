// SPEC §4.5 트리거 조건: company_id와 position_id가 모두 확정된 시점에만 버튼을 노출한다.
export function shouldShowActionMenu(companyId: string | null | undefined, positionId: string | null | undefined): boolean {
  return Boolean(companyId && positionId);
}
