import { listPlatformChoices, listSymptomChoices } from '@/lib/curator/slug-catalog'
import { NewFlowForm } from '@/components/curator/new-flow-form'

export const metadata = { title: 'Curator — New flow' }

export default function NewFlowPage() {
  return (
    <div className="vt-curator-page">
      <header><h1>New flow</h1></header>
      <NewFlowForm platforms={listPlatformChoices()} symptoms={listSymptomChoices()} />
    </div>
  )
}
