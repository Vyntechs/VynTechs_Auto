export function KnowledgeEmptyState({ hasFilters }: { hasFilters: boolean }) {
  if (hasFilters) {
    return (
      <div className="vk-empty">
        <div className="vk-empty__eyebrow">NO MATCH</div>
        <h2 className="vk-empty__title">Nothing matches these filters.</h2>
        <p className="vk-empty__body">
          Loosen one of the chips above, or clear them all and search by title.
        </p>
      </div>
    )
  }
  return (
    <div className="vk-empty">
      <div className="vk-empty__eyebrow">EMPTY</div>
      <h2 className="vk-empty__title">Nothing here yet.</h2>
      <p className="vk-empty__body">
        Paste a TSB, a pinout from AllData, or one of your bench notes.
        The AI consults this list before its training when it runs into a
        vehicle-specific gap mid-diagnostic.
      </p>
    </div>
  )
}
