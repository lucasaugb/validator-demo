/**
 * Declarações pra permitir `import x from "world-atlas/countries-110m.json"`
 * (TopoJSON). Tratamos como objeto opaco: a tipagem fina vem do
 * `react-simple-maps` que aceita um geography object.
 */
declare module 'world-atlas/countries-110m.json' {
  const value: object
  export default value
}
declare module 'world-atlas/countries-50m.json' {
  const value: object
  export default value
}
