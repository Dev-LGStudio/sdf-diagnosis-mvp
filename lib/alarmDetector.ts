export interface AlarmCode {
  type: 'display_code' | 'spn' | 'ecu'
  value: string
}

export function detectAlarmCodes(query: string): AlarmCode[] {
  const codes: AlarmCode[] = []

  // Pattern 1: display code completo (ANTENNA_1437931, eTCV_7602178)
  const displayPattern = /\b([A-Za-z]{2,10}_\d{6,10})\b/g

  // Pattern 2: SPN esplicito (SPN 520213 o SPN520213)
  const spnPattern = /\bSPN\s*(\d{4,6})\b/gi

  // Pattern 3: solo nome ECU (tecnico scrive "ANTENNA error" o "CTM fault")
  const ecuPattern = /\b(ANTENNA|CTM|EHR|EHS|ECUF|ECUR|ECUB|ECUS|ECUM|ECUA|ATC|HBS|SCR|EGR)\b/g

  let match
  while ((match = displayPattern.exec(query)) !== null)
    codes.push({ type: 'display_code', value: match[1] })
  while ((match = spnPattern.exec(query)) !== null)
    codes.push({ type: 'spn', value: match[1] })
  while ((match = ecuPattern.exec(query)) !== null)
    codes.push({ type: 'ecu', value: match[1] })

  return codes.filter(
    (c, idx, arr) =>
      arr.findIndex(x => x.type === c.type && x.value === c.value) === idx
  )
}
