import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'

const TRACKED_TABLES = new Map([
  ['customers', 'customers'],
  ['vehicles', 'vehicles'],
  ['sessions', 'sessions'],
  ['sessionEvents', 'session_events'],
  ['tickets', 'tickets'],
  ['ticketJobs', 'ticket_jobs'],
  ['jobLines', 'job_lines'],
  ['quoteVersions', 'quote_versions'],
  ['quoteEvents', 'quote_events'],
])

// These factories are callable by contract and do not conceal continuity writers:
// React preserves the callback, Drizzle builds schema enum constructors, and the
// retrieval builder is source-visible (or injected with that exact function type).
const PROVEN_SAFE_CALLABLE_FACTORIES = new Set([
  'buildGenerateInitialTreeWithRetrieval',
  'pgEnum',
  'useCallback',
])

export type ProgramMutationSiteV1 = Readonly<{
  file: string
  owner: string
  operation: string
  table: string
  position: number
}>

export type ProgramUnresolvedDynamicCallV1 = Readonly<{
  file: string
  owner: string
  position: number
}>

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) current = current.expression
  return current
}

function callPropertyName(expression: ts.LeftHandSideExpression): string | null {
  const unwrapped = unwrapExpression(expression)
  if (ts.isPropertyAccessExpression(unwrapped)) return unwrapped.name.text
  if (
    ts.isElementAccessExpression(unwrapped) &&
    unwrapped.argumentExpression &&
    (ts.isStringLiteral(unwrapped.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(unwrapped.argumentExpression))
  ) return unwrapped.argumentExpression.text
  return null
}

function functionName(node: ts.FunctionLikeDeclaration): string | null {
  if ('name' in node && node.name) {
    if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text
  }
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) return node.parent.name.text
  return null
}

function isFunctionWithBody(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionLike(node) && 'body' in node && node.body !== undefined
}

export class TypeScriptProgramGraphV1 {
  readonly program: ts.Program
  readonly checker: ts.TypeChecker
  private readonly root: string
  private readonly virtual: boolean
  private readonly functionNodes = new Map<string, ts.FunctionLikeDeclaration>()
  private readonly directEdges = new Map<string, Set<string>>()
  private readonly reverseEdges = new Map<string, Set<string>>()
  private readonly mutationSites: ProgramMutationSiteV1[] = []
  private readonly unresolvedCalls: ProgramUnresolvedDynamicCallV1[] = []

  constructor(program: ts.Program, options: Readonly<{ root: string; virtual?: boolean }>) {
    this.program = program
    this.checker = program.getTypeChecker()
    this.root = options.root
    this.virtual = options.virtual === true
    this.index()
  }

  private fileLabel(sourceFile: ts.SourceFile): string {
    if (this.virtual) return sourceFile.fileName.replaceAll('\\', '/')
    return relative(this.root, sourceFile.fileName).replaceAll('\\', '/')
  }

  private bindTarget(initializer: ts.Expression): ts.Expression | null {
    const current = unwrapExpression(initializer)
    if (!ts.isCallExpression(current)) return null
    const callee = unwrapExpression(current.expression)
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'bind') return null
    return unwrapExpression(callee.expression)
  }

  private objectLiteralFromExpression(
    expression: ts.Expression,
    seen = new Set<ts.Symbol>(),
  ): ts.ObjectLiteralExpression | null {
    const current = unwrapExpression(expression)
    if (ts.isObjectLiteralExpression(current)) return current
    if (!ts.isIdentifier(current)) return null
    const symbol = this.checker.getSymbolAtLocation(current)
    if (!symbol || seen.has(symbol)) return null
    seen.add(symbol)
    const declaration = symbol.valueDeclaration
    return declaration && ts.isVariableDeclaration(declaration) && declaration.initializer
      ? this.objectLiteralFromExpression(declaration.initializer, seen)
      : null
  }

  private bindingElementTarget(declaration: ts.BindingElement): ts.Expression | null {
    if (!ts.isObjectBindingPattern(declaration.parent)) return null
    const variable = declaration.parent.parent
    if (!ts.isVariableDeclaration(variable) || !variable.initializer) return null
    const object = this.objectLiteralFromExpression(variable.initializer)
    if (!object) return null
    const keyNode = declaration.propertyName ?? declaration.name
    if (!ts.isIdentifier(keyNode) && !ts.isStringLiteral(keyNode)) return null
    const key = keyNode.text
    for (const property of object.properties) {
      if (ts.isPropertyAssignment(property)) {
        const name = property.name
        if ((ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === key) {
          return unwrapExpression(property.initializer)
        }
      }
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === key) {
        return property.name
      }
    }
    return null
  }

  private canonicalFromExpression(
    expression: ts.Expression,
    seen: Set<ts.Symbol>,
  ): ts.Symbol | undefined {
    const current = unwrapExpression(expression)
    const bound = this.bindTarget(current)
    const target = bound ?? current
    if (ts.isCallExpression(target)) {
      const callee = unwrapExpression(target.expression)
      const lookup = ts.isPropertyAccessExpression(callee) ? callee.name : callee
      const factory = this.canonicalSymbolAt(lookup, seen)
      const declaration = factory?.valueDeclaration ?? factory?.declarations?.[0]
      return declaration && isFunctionWithBody(declaration) ? factory : undefined
    }
    if (ts.isIdentifier(target) || ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
      return this.canonicalSymbolAt(
        ts.isPropertyAccessExpression(target) ? target.name : target,
        seen,
      )
    }
    return undefined
  }

  private canonicalSymbolAt(node: ts.Node, seen = new Set<ts.Symbol>()): ts.Symbol | undefined {
    let symbol = this.checker.getSymbolAtLocation(node)
    if (!symbol || seen.has(symbol)) return symbol
    seen.add(symbol)
    while (symbol.flags & ts.SymbolFlags.Alias) {
      const aliased = this.checker.getAliasedSymbol(symbol)
      if (aliased === symbol || seen.has(aliased)) break
      symbol = aliased
      seen.add(symbol)
    }

    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (declaration && ts.isBindingElement(declaration)) {
      const target = this.bindingElementTarget(declaration)
      return target ? this.canonicalFromExpression(target, seen) ?? symbol : symbol
    }
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return this.canonicalFromExpression(declaration.initializer, seen) ?? symbol
    }
    if (declaration && ts.isPropertyAssignment(declaration)) {
      return this.canonicalFromExpression(declaration.initializer, seen) ?? symbol
    }
    if (declaration && ts.isShorthandPropertyAssignment(declaration)) {
      return this.canonicalSymbolAt(declaration.name, seen) ?? symbol
    }
    return symbol
  }

  private symbolId(symbol: ts.Symbol | undefined): string | null {
    if (!symbol) return null
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.find((candidate) => (
      ts.isFunctionDeclaration(candidate) ||
      ts.isMethodDeclaration(candidate) ||
      ts.isVariableDeclaration(candidate)
    )) ?? symbol.declarations?.[0]
    if (!declaration) return null
    const file = this.fileLabel(declaration.getSourceFile())
    const name = symbol.getName()
    return `${file}#${name}`
  }

  private functionId(node: ts.FunctionLikeDeclaration): string {
    const name = functionName(node) ?? `<callback@${node.getStart()}>`
    return `${this.fileLabel(node.getSourceFile())}#${name}`
  }

  private ownerId(node: ts.Node): string {
    let current: ts.Node | undefined = node
    while (current && !ts.isSourceFile(current)) {
      if (isFunctionWithBody(current)) return this.functionId(current)
      current = current.parent
    }
    return `${this.fileLabel(node.getSourceFile())}#<module>`
  }

  private addEdge(caller: string, callee: string): void {
    if (caller === callee) return
    const outgoing = this.directEdges.get(caller) ?? new Set<string>()
    outgoing.add(callee)
    this.directEdges.set(caller, outgoing)
    const incoming = this.reverseEdges.get(callee) ?? new Set<string>()
    incoming.add(caller)
    this.reverseEdges.set(callee, incoming)
  }

  private tableFromExpression(node: ts.Expression): { logical: string; sql: string } | null {
    const unwrapped = unwrapExpression(node)
    const lookup = ts.isPropertyAccessExpression(unwrapped) ? unwrapped.name : unwrapped
    const symbol = this.canonicalSymbolAt(lookup)
    if (!symbol) return null
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (!declaration) return null
    const logical = symbol.getName()
    const sql = TRACKED_TABLES.get(logical)
    const file = this.fileLabel(declaration.getSourceFile())
    if (!sql || !file.endsWith('schema.ts')) return null
    return { logical, sql }
  }

  private staticString(node: ts.Expression, seen = new Set<ts.Node>()): string | null {
    const current = unwrapExpression(node)
    if (seen.has(current)) return null
    seen.add(current)
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) return current.text
    if (ts.isTaggedTemplateExpression(current)) return this.staticString(current.template, seen)
    if (ts.isTemplateExpression(current)) {
      let value = current.head.text
      for (const span of current.templateSpans) {
        const table = this.tableFromExpression(span.expression)
        const interpolation = table?.sql ?? this.staticString(span.expression, seen) ?? '?'
        value += interpolation + span.literal.text
      }
      return value
    }
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = this.staticString(current.left, seen)
      const right = this.staticString(current.right, seen)
      return left === null || right === null ? null : left + right
    }
    if (ts.isIdentifier(current)) {
      const symbol = this.checker.getSymbolAtLocation(current)
      const declaration = symbol?.valueDeclaration
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return this.staticString(declaration.initializer, seen)
      }
    }
    return null
  }

  private collectMutation(node: ts.CallExpression): void {
    const expression = unwrapExpression(node.expression)
    const lookup = ts.isPropertyAccessExpression(expression) ? expression.name : expression
    const directOperation = callPropertyName(node.expression)
    const directSymbol = this.checker.getSymbolAtLocation(lookup)
    const canonical = this.canonicalSymbolAt(lookup)
    const directDeclaration = directSymbol?.valueDeclaration ?? directSymbol?.declarations?.[0]
    const indirectOperation = (
      directOperation === null &&
      directDeclaration !== undefined &&
      (ts.isVariableDeclaration(directDeclaration) || ts.isBindingElement(directDeclaration))
    ) ? canonical?.getName() ?? null : null
    const operation = directOperation === null
      ? indirectOperation
      : canonical?.getName() ?? directOperation
    if (!operation) return
    const owner = this.ownerId(node)
    const file = this.fileLabel(node.getSourceFile())
    if (['insert', 'update', 'delete'].includes(operation)) {
      const target = node.arguments[0] && this.tableFromExpression(node.arguments[0])
      if (target) this.mutationSites.push({ file, owner, operation, table: target.logical, position: node.getStart() })
      return
    }
    if (operation !== 'execute' || !node.arguments[0]) return
    const sql = this.staticString(node.arguments[0])
    if (sql === null) {
      this.mutationSites.push({ file, owner, operation: 'unknown-sql', table: '<unknown>', position: node.getStart() })
      return
    }
    for (const [logical, sqlTable] of TRACKED_TABLES) {
      const match = new RegExp(
        `\\b(insert\\s+into|update|delete\\s+from)\\s+(?:public\\.)?"?${sqlTable}"?\\b`,
        'i',
      ).exec(sql)
      if (!match) continue
      this.mutationSites.push({
        file,
        owner,
        operation: `raw-${match[1]!.toLowerCase().replace(/\\s+/g, '-')}`,
        table: logical,
        position: node.getStart(),
      })
    }
  }

  private unresolvedCallableReference(node: ts.Node, canonical: ts.Symbol | undefined): boolean {
    const symbol = this.checker.getSymbolAtLocation(node)
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
    if (!declaration) return canonical === undefined
    if (ts.isBindingElement(declaration)) {
      if (!ts.isObjectBindingPattern(declaration.parent)) return false
      if (this.bindingElementTarget(declaration) !== null) return false
      const variable = declaration.parent.parent
      return ts.isVariableDeclaration(variable) && variable.initializer !== undefined &&
        ts.isCallExpression(unwrapExpression(variable.initializer))
    }
    const initializer = ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)
      ? declaration.initializer
      : undefined
    if (!initializer) return false
    const current = unwrapExpression(initializer)
    if (
      ts.isIdentifier(current) || ts.isPropertyAccessExpression(current) ||
      ts.isElementAccessExpression(current) || ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current)
    ) return false
    if (ts.isCallExpression(current)) {
      if (this.bindTarget(current) !== null) return false
      const callee = unwrapExpression(current.expression)
      const lookup = ts.isPropertyAccessExpression(callee) ? callee.name : callee
      if (ts.isIdentifier(lookup) && PROVEN_SAFE_CALLABLE_FACTORIES.has(lookup.text)) return false
      const factory = this.canonicalSymbolAt(lookup)
      const factoryDeclaration = factory?.valueDeclaration ?? factory?.declarations?.[0]
      return !factoryDeclaration || !isFunctionWithBody(factoryDeclaration)
    }
    if (ts.isPropertyAssignment(declaration)) return true
    return false
  }

  private isObjectLiteralPropertyReference(node: ts.Node): boolean {
    const symbol = this.checker.getSymbolAtLocation(node)
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
    return declaration !== undefined && ts.isPropertyAssignment(declaration) &&
      ts.isObjectLiteralExpression(declaration.parent)
  }

  private index(): void {
    for (const sourceFile of this.program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) continue
      const visit = (node: ts.Node): void => {
        if (isFunctionWithBody(node)) {
          const id = this.functionId(node)
          this.functionNodes.set(id, node)
          if (!ts.isFunctionDeclaration(node)) {
            const lexicalOwner = this.ownerId(node.parent)
            if (!lexicalOwner.endsWith('#<module>')) this.addEdge(lexicalOwner, id)
          }
        }
        if (ts.isCallExpression(node)) {
          const caller = this.ownerId(node)
          const expression = unwrapExpression(node.expression)
          const lookup = ts.isPropertyAccessExpression(expression) ? expression.name : expression
          const canonical = this.canonicalSymbolAt(lookup)
          if (
            (ts.isElementAccessExpression(expression) &&
              callPropertyName(expression) === null &&
              !canonical &&
              !ts.isPropertyAccessExpression(expression.argumentExpression)) ||
            ((ts.isIdentifier(expression) || this.isObjectLiteralPropertyReference(lookup)) &&
              this.unresolvedCallableReference(lookup, canonical))
          ) {
            this.unresolvedCalls.push({
              file: this.fileLabel(node.getSourceFile()),
              owner: caller,
              position: node.getStart(),
            })
          }
          const callee = this.symbolId(canonical)
          if (callee) this.addEdge(caller, callee)
          for (const argument of node.arguments) {
            const unwrapped = unwrapExpression(argument)
            if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
              this.addEdge(caller, this.functionId(unwrapped))
            }
          }
          this.collectMutation(node)
        }
        ts.forEachChild(node, visit)
      }
      visit(sourceFile)
    }
  }

  mutations(): readonly ProgramMutationSiteV1[] {
    return [...this.mutationSites].sort((left, right) => (
      left.file.localeCompare(right.file) || left.position - right.position
    ))
  }

  assertNoUnknownSql(): void {
    const unknown = this.mutations().filter(({ operation }) => operation === 'unknown-sql')
    if (unknown.length === 0) return
    throw new Error(`Unclassified dynamic SQL: ${unknown.map(({ owner }) => owner).join(', ')}`)
  }

  unresolvedDynamicCalls(): readonly ProgramUnresolvedDynamicCallV1[] {
    return [...this.unresolvedCalls].sort((left, right) => (
      left.file.localeCompare(right.file) || left.position - right.position
    ))
  }

  assertNoUnresolvedDynamicCalls(): void {
    const unresolved = this.unresolvedDynamicCalls().filter(({ file }) => (
      this.virtual || file.startsWith('app/') || file.startsWith('lib/')
    ))
    if (unresolved.length === 0) return
    throw new Error(`Unresolved dynamic calls: ${unresolved.map(({ owner }) => owner).join(', ')}`)
  }

  transitiveCallees(owner: string): readonly string[] {
    const found = new Set<string>()
    const pending = [...(this.directEdges.get(owner) ?? [])]
    while (pending.length > 0) {
      const current = pending.pop()!
      if (found.has(current)) continue
      found.add(current)
      pending.push(...(this.directEdges.get(current) ?? []))
    }
    return [...found].sort()
  }

  directCallers(callee: string): readonly string[] {
    return [...(this.reverseEdges.get(callee) ?? [])].sort()
  }

  transitiveCallers(callee: string): readonly string[] {
    const found = new Set<string>()
    const pending = [...(this.reverseEdges.get(callee) ?? [])]
    while (pending.length > 0) {
      const current = pending.pop()!
      if (found.has(current)) continue
      found.add(current)
      pending.push(...(this.reverseEdges.get(current) ?? []))
    }
    return [...found].sort()
  }

  exportersOf(symbolId: string): readonly string[] {
    const exporters = new Set<string>()
    for (const sourceFile of this.program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) continue
      const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile)
      if (!moduleSymbol) continue
      for (const exported of this.checker.getExportsOfModule(moduleSymbol)) {
        if (this.symbolId(this.canonicalSymbolAt(exported.declarations?.[0] ?? sourceFile)) === symbolId) {
          exporters.add(this.fileLabel(sourceFile))
          break
        }
        let canonical = exported
        if (canonical.flags & ts.SymbolFlags.Alias) canonical = this.checker.getAliasedSymbol(canonical)
        if (this.symbolId(canonical) === symbolId) {
          exporters.add(this.fileLabel(sourceFile))
          break
        }
      }
    }
    return [...exporters].sort()
  }

  callOrder(owner: string, callees: readonly string[]): readonly number[] {
    const node = this.functionNodes.get(owner)
    if (!node) return callees.map(() => -1)
    const positions = callees.map((callee) => {
      let earliest = Number.POSITIVE_INFINITY
      const visit = (child: ts.Node): void => {
        if (child !== node.body && ts.isFunctionDeclaration(child)) return
        if (ts.isCallExpression(child)) {
          const expression = unwrapExpression(child.expression)
          const lookup = ts.isPropertyAccessExpression(expression) ? expression.name : expression
          const resolved = this.symbolId(this.canonicalSymbolAt(lookup))
          if (
            resolved === callee ||
            (resolved !== null && this.transitiveCallees(resolved).includes(callee))
          ) earliest = Math.min(earliest, child.getStart())
        }
        ts.forEachChild(child, visit)
      }
      if (node.body) visit(node.body)
      return earliest
    })
    const ordered = [...positions].filter(Number.isFinite).sort((left, right) => left - right)
    return positions.map((position) => Number.isFinite(position) ? ordered.indexOf(position) : -1)
  }

  private isUnconditionalTopLevelCall(
    call: ts.CallExpression,
    body: ts.Block,
  ): boolean {
    let current: ts.Node = call
    while (current.parent !== body) {
      const parent = current.parent
      if (
        ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent) ||
        ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) ||
        ts.isNonNullExpression(parent) || ts.isTypeAssertionExpression(parent) ||
        (ts.isVariableDeclaration(parent) && parent.initializer === current) ||
        ts.isVariableDeclarationList(parent) || ts.isVariableStatement(parent) ||
        ts.isExpressionStatement(parent)
      ) {
        current = parent
        continue
      }
      return false
    }
    return ts.isVariableStatement(current) || ts.isExpressionStatement(current)
  }

  gateDominatesWriter(owner: string, gate: string, writer: string): boolean {
    const node = this.functionNodes.get(owner)
    if (!node?.body || !ts.isBlock(node.body)) return false
    const body = node.body
    let gatePosition = Number.POSITIVE_INFINITY
    let writerPosition = Number.POSITIVE_INFINITY
    const visit = (child: ts.Node): void => {
      if (child !== body && ts.isFunctionDeclaration(child)) return
      if (ts.isCallExpression(child)) {
        const expression = unwrapExpression(child.expression)
        const lookup = ts.isPropertyAccessExpression(expression) ? expression.name : expression
        const resolved = this.symbolId(this.canonicalSymbolAt(lookup))
        if (resolved === gate && this.isUnconditionalTopLevelCall(child, body)) {
          gatePosition = Math.min(gatePosition, child.getStart())
        }
        if (
          resolved === writer ||
          (resolved !== null && this.transitiveCallees(resolved).includes(writer))
        ) writerPosition = Math.min(writerPosition, child.getStart())
      }
      ts.forEachChild(child, visit)
    }
    visit(body)
    return Number.isFinite(gatePosition) && Number.isFinite(writerPosition) && gatePosition < writerPosition
  }
}

export function createVirtualTypeScriptProgramGraphV1(
  files: Readonly<Record<string, string>>,
): TypeScriptProgramGraphV1 {
  const normalized = new Map(
    Object.entries(files).map(([file, source]) => [file.replaceAll('\\', '/'), source]),
  )
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
  }
  const host = ts.createCompilerHost(options)
  const fileExists = host.fileExists.bind(host)
  const readFile = host.readFile.bind(host)
  host.fileExists = (file) => normalized.has(file.replaceAll('\\', '/')) || fileExists(file)
  host.readFile = (file) => normalized.get(file.replaceAll('\\', '/')) ?? readFile(file)
  host.getSourceFile = (file, languageVersion) => {
    const source = host.readFile(file)
    return source === undefined ? undefined : ts.createSourceFile(file, source, languageVersion, true)
  }
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((moduleName) => {
    if (moduleName.startsWith('.')) {
      const candidate = `${resolve(dirname(containingFile), moduleName).replaceAll('\\', '/')}.ts`
      if (normalized.has(candidate)) {
        return { resolvedFileName: candidate, extension: ts.Extension.Ts }
      }
    }
    return ts.resolveModuleName(moduleName, containingFile, options, host).resolvedModule
  })
  const program = ts.createProgram({ rootNames: [...normalized.keys()], options, host })
  return new TypeScriptProgramGraphV1(program, { root: '/virtual', virtual: true })
}

export function createTypeScriptProgramGraphV1(): TypeScriptProgramGraphV1 {
  const root = process.cwd()
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json')
  if (!configPath) throw new Error('tsconfig.json not found')
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, (file) => readFileSync(file, 'utf8')).config,
    ts.sys,
    resolve(configPath, '..'),
  )
  const roots = config.fileNames.filter((file) => {
    const label = relative(root, file).replaceAll('\\', '/')
    return label.startsWith('app/') || label.startsWith('lib/') || label === 'middleware.ts'
  })
  const program = ts.createProgram({ rootNames: roots, options: config.options })
  return new TypeScriptProgramGraphV1(program, { root })
}
