; Busy 21 — Finalise bill paste from PASPL clipboard
; Requires AutoHotkey v1.1.29+ (https://www.autohotkey.com/)
;
; Clipboard format (tab-separated, one line per item):
;   ItemName<TAB>Qty<TAB>Unit<TAB>MRP
; Unit is blank for default pcs: ItemName<TAB>Qty<TAB><TAB>MRP
;
; Operator setup:
;   1. In PASPL billing: resolve flags → Copy final bill
;   2. In Busy: open Modify Sales Voucher, party/transport set, cursor on first empty Item cell
;   3. Press Ctrl+Alt+B to paste all lines
;   4. Review totals → F2 Save
;
; Hotkeys:
;   Ctrl+Alt+B — paste all clipboard lines
;   Esc        — abort mid-run

#NoEnv
#SingleInstance Force
SetBatchLines -1
SendMode Input
SetKeyDelay 40, 40
SetControlDelay 40

global gRunning := false
global gStopRequested := false

^!b::
  if (gRunning) {
    ToolTip, Busy paste already running…
    SetTimer, ClearToolTip, -1500
    return
  }
  PasteFinalBillFromClipboard()
return

Esc::
  if (gRunning) {
    gStopRequested := true
    ToolTip, Stopping after current line…
  }
return

PasteFinalBillFromClipboard() {
  global gRunning, gStopRequested
  gRunning := true
  gStopRequested := false

  clipText := Clipboard
  if (clipText = "") {
    MsgBox, 48, Busy paste, Clipboard is empty.`nCopy the final bill in PASPL first.
    gRunning := false
    return
  }

  lineList := []
  for , rawLine in StrSplit(clipText, "`n", "`r") {
    line := Trim(rawLine)
    if (line != "")
      lineList.Push(line)
  }

  lineCount := lineList.Length()
  if (lineCount = 0) {
    MsgBox, 48, Busy paste, No paste lines found in clipboard.
    gRunning := false
    return
  }

  pastedCount := 0
  for index, lineText in lineList {
    if (gStopRequested)
      break

    fields := StrSplit(lineText, "`t", , 4)
    fieldCount := fields.Length()
    if (fieldCount < 4) {
      MsgBox, 48, Busy paste, Line %index% has %fieldCount% columns (need 4).`nAborting.`n`n%lineText%
      break
    }

    itemName := fields[1]
    qty := fields[2]
    unit := fields[3]
    mrp := fields[4]

    ToolTip, Pasting line %index% of %lineCount%`n%itemName%

    SendInput, %itemName%
    Sleep, 120
    Send, {Tab}
    Sleep, 80

    SendInput, %qty%
    Sleep, 80
    Send, {Tab}
    Sleep, 80

    if (unit != "") {
      SendInput, %unit%
      Sleep, 80
    }
    Send, {Tab}
    Sleep, 80

    SendInput, %mrp%
    Sleep, 150
    Send, {Enter}
    Sleep, 200

    Send, {Enter}
    Sleep, 150

    Send, {Enter}
    Sleep, 120

    pastedCount := index
    if (index < lineCount) {
      Send, {Down}
      Sleep, 80
    }
  }

  ToolTip, Done — pasted %pastedCount% line(s). Review totals then F2 save.
  SetTimer, ClearToolTip, -4000
  gRunning := false
  gStopRequested := false
}

ClearToolTip:
  ToolTip
return
