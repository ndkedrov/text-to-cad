// The backend lists actual server files; browser print exports are available
// after that part's STEP finishes, from the same saved spec.
export function withClientBoxExports(payload) {
  const formats = (payload.clientExportFormats || []).filter((format) => ["stl", "3mf"].includes(format));
  if (!formats.length) return payload;
  const outputs = [...(payload.outputs || [])];
  for (const step of payload.outputs || []) {
    if (step.format !== "step") continue;
    for (const format of formats) {
      if (outputs.some((output) => output.part === step.part && output.format === format)) continue;
      outputs.push({ part: step.part, format, file: `${payload.name}_${step.part}.${format}`, client: true });
    }
  }
  return { ...payload, outputs };
}
