import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CustomerApproval } from '@/components/screens/customer-approval'
import { isCustomerApprovalEnabled } from '@/lib/release-policy'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = {
  title: 'Review repair order',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function ApprovalPage(): React.JSX.Element {
  if (!isCustomerApprovalEnabled()) notFound()
  return <CustomerApproval />
}
