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

export type ProgramMutationSiteV1 = Readonly<{
  file: string
  owner: string
  operation: string
  table: string
  position: number
}>

export type ProgramSymbolReferenceViolationV1 = Readonly<{
  symbol: string
  file: string
  owner: string
  reason: 'first-class-value' | 'unapproved-direct-caller'
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

function isFunctionWithBody(
  node: ts.Node,
): node is ts.FunctionLikeDeclaration & { body: ts.ConciseBody } {
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
  private readonly mutationSinkSymbols = new Set<ts.Symbol>()

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

  private aliasedSymbolAt(node: ts.Node): ts.Symbol | undefined {
    let symbol = this.checker.getSymbolAtLocation(node)
    const seen = new Set<ts.Symbol>()
    while (symbol && symbol.flags & ts.SymbolFlags.Alias && !seen.has(symbol)) {
      seen.add(symbol)
      const aliased = this.checker.getAliasedSymbol(symbol)
      if (aliased === symbol) break
      symbol = aliased
    }
    return symbol
  }

  private canonicalFromExpression(
    expression: ts.Expression,
    seen: Set<ts.Symbol>,
  ): ts.Symbol | undefined {
    const current = unwrapExpression(expression)
    if (ts.isIdentifier(current) || ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      return this.canonicalSymbolAt(
        ts.isPropertyAccessExpression(current) ? current.name : current,
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

  private isDeclarationOrPlumbingReference(node: ts.Node): boolean {
    if (!ts.isIdentifier(node)) return false
    const parent = node.parent
    if (
      ts.isImportSpecifier(parent) ||
      ts.isExportSpecifier(parent) ||
      ts.isExportAssignment(parent) ||
      ts.isImportClause(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isImportEqualsDeclaration(parent)
    ) return true
    if (
      (ts.isFunctionDeclaration(parent) ||
        ts.isFunctionExpression(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isMethodSignature(parent) ||
        ts.isVariableDeclaration(parent) ||
        ts.isParameter(parent) ||
        ts.isPropertyAssignment(parent) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isPropertySignature(parent) ||
        ts.isClassDeclaration(parent) ||
        ts.isClassExpression(parent) ||
        ts.isInterfaceDeclaration(parent) ||
        ts.isTypeAliasDeclaration(parent) ||
        ts.isEnumDeclaration(parent)) &&
      parent.name === node
    ) return true
    let current: ts.Node | undefined = node.parent
    while (current && !ts.isStatement(current) && !ts.isExpression(current)) {
      if (ts.isTypeNode(current)) return true
      current = current.parent
    }
    return false
  }

  private isExactDirectCalleeReference(node: ts.Node): boolean {
    let expression: ts.Node = node
    if (ts.isIdentifier(node) && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) {
      expression = node.parent
    } else if (
      (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      ts.isElementAccessExpression(node.parent) &&
      node.parent.argumentExpression === node
    ) expression = node.parent
    const parent = expression.parent
    return (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === expression
  }

  private symbolReferenceNodes(sourceFile: ts.SourceFile): readonly ts.Node[] {
    const references: ts.Node[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        references.push(node)
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return references
  }

  private sortedReferenceViolations(
    violations: ProgramSymbolReferenceViolationV1[],
  ): readonly ProgramSymbolReferenceViolationV1[] {
    return violations.sort((left, right) => (
      left.file.localeCompare(right.file) || left.position - right.position || left.symbol.localeCompare(right.symbol)
    ))
  }

  symbolReferenceViolations(
    policy: ReadonlyMap<string, ReadonlySet<string>>,
  ): readonly ProgramSymbolReferenceViolationV1[] {
    const violations: ProgramSymbolReferenceViolationV1[] = []
    for (const sourceFile of this.program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) continue
      const recordedBindings = new Set<ts.BindingElement>()
      for (const node of this.symbolReferenceNodes(sourceFile)) {
        const binding = ts.isBindingElement(node.parent) ? node.parent : undefined
        const symbol = binding ? this.destructuredPropertySymbol(binding) : this.aliasedSymbolAt(node)
        const symbolName = this.symbolId(symbol)
        if (!symbolName || !policy.has(symbolName) || this.isDeclarationOrPlumbingReference(node)) continue
        if (binding && recordedBindings.has(binding)) continue
        if (binding) recordedBindings.add(binding)
        const owner = this.ownerId(node)
        const direct = this.isExactDirectCalleeReference(node)
        if (direct && policy.get(symbolName)!.has(owner)) continue
        violations.push({
          symbol: symbolName,
          file: this.fileLabel(sourceFile),
          owner,
          reason: direct ? 'unapproved-direct-caller' : 'first-class-value',
          position: node.getStart(),
        })
      }
    }
    return this.sortedReferenceViolations(violations)
  }

  private destructuredPropertySymbol(node: ts.BindingElement): ts.Symbol | undefined {
    if (!ts.isObjectBindingPattern(node.parent)) return undefined
    const declaration = node.parent.parent
    if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) return undefined
    const property = node.propertyName ?? node.name
    if (!ts.isIdentifier(property) && !ts.isStringLiteral(property) && !ts.isNumericLiteral(property)) return undefined
    return this.checker.getTypeAtLocation(declaration.initializer).getProperty(property.text)
  }

  mutationSinkReferenceViolations(): readonly ProgramSymbolReferenceViolationV1[] {
    const violations: ProgramSymbolReferenceViolationV1[] = []
    for (const sourceFile of this.program.getSourceFiles()) {
      if (sourceFile.isDeclarationFile) continue
      const recordedBindings = new Set<ts.BindingElement>()
      for (const node of this.symbolReferenceNodes(sourceFile)) {
        const binding = ts.isBindingElement(node.parent) ? node.parent : undefined
        const symbol = binding ? this.destructuredPropertySymbol(binding) : this.aliasedSymbolAt(node)
        if (!symbol || !this.mutationSinkSymbols.has(symbol) || this.isDeclarationOrPlumbingReference(node)) continue
        if (binding && recordedBindings.has(binding)) continue
        if (binding) recordedBindings.add(binding)
        if (!binding && this.isExactDirectCalleeReference(node)) continue
        violations.push({
          symbol: this.symbolId(symbol) ?? symbol.getName(),
          file: this.fileLabel(sourceFile),
          owner: this.ownerId(node),
          reason: 'first-class-value',
          position: node.getStart(),
        })
      }
    }
    return this.sortedReferenceViolations(violations)
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
    const canonical = this.canonicalSymbolAt(lookup)
    const operation = directOperation === null ? null : canonical?.getName() ?? directOperation
    if (!operation) return
    const owner = this.ownerId(node)
    const file = this.fileLabel(node.getSourceFile())
    if (['insert', 'update', 'delete'].includes(operation)) {
      const target = node.arguments[0] && this.tableFromExpression(node.arguments[0])
      if (target) {
        if (canonical) this.mutationSinkSymbols.add(canonical)
        this.mutationSites.push({ file, owner, operation, table: target.logical, position: node.getStart() })
      }
      return
    }
    if (operation !== 'execute' || !node.arguments[0]) return
    if (canonical) this.mutationSinkSymbols.add(canonical)
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
          const callee = this.symbolId(this.aliasedSymbolAt(lookup))
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
          const resolved = this.symbolId(this.aliasedSymbolAt(lookup))
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

  private directCallFromInitializer(expression: ts.Expression): ts.CallExpression | null {
    let current = unwrapExpression(expression)
    if (ts.isAwaitExpression(current)) current = unwrapExpression(current.expression)
    return ts.isCallExpression(current) ? current : null
  }

  private refusalGuardIndexes(body: ts.Block, gate: string): readonly number[] {
    const guards: number[] = []
    body.statements.forEach((statement, declarationIndex) => {
      if (!ts.isVariableStatement(statement) ||
        !(statement.declarationList.flags & ts.NodeFlags.Const) ||
        statement.declarationList.declarations.length !== 1) return
      const declaration = statement.declarationList.declarations[0]!
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return
      const call = this.directCallFromInitializer(declaration.initializer)
      if (!call) return
      const callee = unwrapExpression(call.expression)
      const lookup = ts.isPropertyAccessExpression(callee) ? callee.name : callee
      if (this.symbolId(this.aliasedSymbolAt(lookup)) !== gate) return
      const deniedSymbol = this.checker.getSymbolAtLocation(declaration.name)
      if (!deniedSymbol) return
      for (let index = declarationIndex + 1; index < body.statements.length; index += 1) {
        const candidate = body.statements[index]!
        if (!ts.isIfStatement(candidate) || candidate.elseStatement) continue
        const condition = unwrapExpression(candidate.expression)
        if (!ts.isIdentifier(condition) || this.checker.getSymbolAtLocation(condition) !== deniedSymbol) continue
        const terminal = ts.isBlock(candidate.thenStatement)
          ? candidate.thenStatement.statements.length === 1
            ? candidate.thenStatement.statements[0]
            : undefined
          : candidate.thenStatement
        if (!terminal) continue
        if (ts.isThrowStatement(terminal)) {
          guards.push(index)
          break
        }
        if (!ts.isReturnStatement(terminal) || !terminal.expression) continue
        const returned = unwrapExpression(terminal.expression)
        if (ts.isIdentifier(returned) && this.checker.getSymbolAtLocation(returned) === deniedSymbol) {
          guards.push(index)
          break
        }
      }
    })
    return guards
  }

  private topLevelStatementIndex(node: ts.Node, body: ts.Block): number {
    let current = node
    while (current.parent !== body) {
      current = current.parent
    }
    return body.statements.indexOf(current as ts.Statement)
  }

  private gateControlsTargets(
    owner: string,
    gate: string,
    isTarget: (call: ts.CallExpression) => boolean,
  ): boolean {
    const node = this.functionNodes.get(owner)
    if (!node?.body || !ts.isBlock(node.body)) return false
    const body = node.body
    const guardIndexes = this.refusalGuardIndexes(body, gate)
    if (guardIndexes.length === 0) return false
    const targets: ts.CallExpression[] = []
    const visit = (child: ts.Node): void => {
      if (child !== body && ts.isFunctionDeclaration(child)) return
      if (ts.isCallExpression(child) && isTarget(child)) targets.push(child)
      ts.forEachChild(child, visit)
    }
    visit(body)
    return targets.length > 0 && targets.every((target) => {
      const targetIndex = this.topLevelStatementIndex(target, body)
      return targetIndex >= 0 && guardIndexes.some((guardIndex) => guardIndex < targetIndex)
    })
  }

  gateDominatesWriter(owner: string, gate: string, writer: string): boolean {
    return this.gateControlsTargets(owner, gate, (call) => {
      const expression = unwrapExpression(call.expression)
      const lookup = ts.isPropertyAccessExpression(expression) ? expression.name : expression
      const resolved = this.symbolId(this.aliasedSymbolAt(lookup))
      return resolved === writer ||
        (resolved !== null && this.transitiveCallees(resolved).includes(writer))
    })
  }

  gateControlsMutations(owner: string, gate: string): boolean {
    const positions = new Set(this.mutationSites
      .filter((site) => site.owner === owner)
      .map(({ position }) => position))
    if (positions.size === 0) return false
    return this.gateControlsTargets(owner, gate, (call) => positions.has(call.getStart()))
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
