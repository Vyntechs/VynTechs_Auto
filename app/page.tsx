import Link from 'next/link'

export default function HomePage() {
  return (
    <main>
      <h1>Vyntechs</h1>
      <p>AI master tech for the bay.</p>
      <nav>
        <Link href="/sign-up">Sign up</Link>
        {' · '}
        <Link href="/sign-in">Sign in</Link>
      </nav>
    </main>
  )
}
