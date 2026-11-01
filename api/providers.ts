export type PaymentMethod = 'bank_transfer' | 'easypaisa' | 'jazzcash' | 'other'

export interface PaymentProvider {
  readonly name: string
  createVerificationRequest(reference: string, amount: number): Promise<{ status: 'pending'; providerReference: string }>
}

export interface SupplierAdapter {
  readonly kind: string
  submitOrder(): Promise<{ status: 'pending_authorization'; supplierOrderId: null }>
}

export class ManualPaymentProvider implements PaymentProvider {
  readonly name = 'manual'

  async createVerificationRequest(reference: string, _amount: number) {
    return { status: 'pending' as const, providerReference: `manual:${reference}` }
  }
}

export class AuthorizationRequiredSupplier implements SupplierAdapter {
  constructor(readonly kind: string) {}

  async submitOrder() {
    return { status: 'pending_authorization' as const, supplierOrderId: null }
  }
}
