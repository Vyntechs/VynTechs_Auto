import { redirect } from 'next/navigation'
import { getServerSupabase } from '@/lib/supabase-server'
import { isFounder } from '@/lib/auth'
import { FounderNoteSubmitForm } from '@/components/curator/founder-note-submit-form'

export default async function NewFounderNotePage() {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!isFounder(user?.id)) {
    // Curators can review the queue but only the founder can submit notes.
    // Bounce back to the list so the flow is clear.
    redirect('/curator/founder-notes')
  }

  return (
    <div className="vt-founder-note-new-page">
      <h1>New founder note</h1>
      <p className="vt-founder-note-new-help">
        Dump anything you remember about a fix — vehicle, symptom, root cause, the part you replaced.
        Voice-to-text is fine. The structurer will pull out the fields and you'll review on the next screen.
      </p>
      <FounderNoteSubmitForm />
    </div>
  )
}
