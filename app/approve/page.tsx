import type { Metadata } from 'next'
import { CustomerApproval } from '@/components/screens/customer-approval'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata: Metadata = {
  title: 'Review repair order',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function ApprovalPage(): React.JSX.Element {
  return <CustomerApproval />
}
