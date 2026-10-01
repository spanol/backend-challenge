export interface ReconciliationRow {
  balance: string;
  currency: string;
  calculated: string;
  entries: string;
}

export type ReconciliationDivergence = {
  walletId: string;
  checkedEntries: number;
};
