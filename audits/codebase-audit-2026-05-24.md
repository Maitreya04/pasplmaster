# PASPL Master Codebase Audit — 2026-05-24

Authoritative scope: current working tree at `/Users/maitreya/pasplmaster`, including uncommitted tracked edits. This audit read all files under `src/`; `.DS_Store` is listed as a binary/system artifact and skipped for semantic source review. No application code was changed.

Evidence conventions: file references use `path:line`; line counts are approximate physical lines as of this working tree.

## SECTION 1 — PROJECT STRUCTURE MAP

Total `src/` files found: **284**. Status counts: **ACTIVE** 267, **DEAD** 2, **UNCLEAR** 15

| File | What it does | ~Lines | Status |
|---|---|---:|---|
| `src/.DS_Store` | Binary/system artifact; not application source | 0 | DEAD |
| `src/App.tsx` | Application router and route guards | 411 | ACTIVE |
| `src/assets/react.svg` | Source file; purpose inferred from filename | 1 | DEAD |
| `src/components/PwaUpdatePrompt.tsx` | PwaUpdatePrompt.tsx UI component: PwaUpdatePrompt | 37 | ACTIVE |
| `src/components/admin/StagingPromotePanel.tsx` | admin UI component: StagingPromotePanel | 89 | ACTIVE |
| `src/components/billing/FulfillmentPathSelector.tsx` | billing UI component: FulfillmentPathSelector | 108 | ACTIVE |
| `src/components/dev/DevRoleSwitcher.tsx` | dev UI component: DevRoleSwitcher | 87 | ACTIVE |
| `src/components/notifications/NotificationBell.tsx` | notifications UI component: NotificationBell | 392 | ACTIVE |
| `src/components/notifications/NotificationDiagnosticsPanel.tsx` | notifications UI component: NotificationDiagnosticsPanel | 79 | ACTIVE |
| `src/components/notifications/PushAlertsCompact.tsx` | notifications UI component: PushAlertsCompact | 87 | ACTIVE |
| `src/components/packCatalog/PrecutSheetPreview.tsx` | packCatalog UI component: PrecutSheetPreview | 152 | ACTIVE |
| `src/components/picking/AvailableOrderRow.tsx` | picking UI component: AvailableOrderRow | 64 | ACTIVE |
| `src/components/picking/BeingPickedCard.tsx` | picking UI component: BeingPickedCard | 117 | ACTIVE |
| `src/components/picking/BeingPickedCarousel.tsx` | picking UI component: BeingPickedCarousel | 85 | ACTIVE |
| `src/components/picking/BrandLineChip.tsx` | picking UI component: BrandLineChip | 35 | ACTIVE |
| `src/components/picking/CardHero.tsx` | picking UI component: CardHero | 145 | ACTIVE |
| `src/components/picking/FlagReasonSheet.tsx` | picking UI component: FlagReasonSheet | 139 | ACTIVE |
| `src/components/picking/JumpListSheet.tsx` | picking UI component: JumpListSheet | 48 | ACTIVE |
| `src/components/picking/PickCard.tsx` | picking UI component: PickCard | 145 | ACTIVE |
| `src/components/picking/PickCardCTAs.tsx` | picking UI component: PickCardCTAs | 60 | ACTIVE |
| `src/components/picking/PickQueuePartyBlock.tsx` | picking UI component: PickQueuePartyBlock | 64 | ACTIVE |
| `src/components/picking/SwipeDeck.tsx` | picking UI component: SwipeDeck | 400 | ACTIVE |
| `src/components/picking/TransportChip.tsx` | picking UI component: TransportChip | 25 | ACTIVE |
| `src/components/receiving/ReceivingGatePanel.tsx` | receiving UI component: ReceivingGatePanel | 580 | ACTIVE |
| `src/components/receiving/ReceivingGrnLineCard.tsx` | receiving UI component: ReceivingGrnLineCard | 602 | ACTIVE |
| `src/components/receiving/ReceivingGrnTable.tsx` | receiving UI component: ReceivingGrnTable | 150 | UNCLEAR |
| `src/components/receiving/ReceivingSortPanel.tsx` | receiving UI component: ReceivingSortPanel | 558 | ACTIVE |
| `src/components/receiving/ReceivingStepper.tsx` | receiving UI component: ReceivingStepper | 71 | ACTIVE |
| `src/components/shared/AliasChip.tsx` | shared UI component: AliasChip | 42 | ACTIVE |
| `src/components/shared/AttributionChips.tsx` | shared UI component: AttributionChips | 49 | ACTIVE |
| `src/components/shared/BigButton.tsx` | shared UI component: BigButton | 50 | ACTIVE |
| `src/components/shared/BottomNav.tsx` | shared UI component: BottomNav | 151 | ACTIVE |
| `src/components/shared/BottomSheet.tsx` | shared UI component: BottomSheet | 213 | ACTIVE |
| `src/components/shared/Card.tsx` | shared UI component: Card | 45 | ACTIVE |
| `src/components/shared/EmptyState.tsx` | shared UI component: EmptyState | 40 | ACTIVE |
| `src/components/shared/FilterChip.tsx` | shared UI component: FilterChip | 74 | ACTIVE |
| `src/components/shared/InitialsAvatar.tsx` | shared UI component: InitialsAvatar | 35 | ACTIVE |
| `src/components/shared/InlineQtyEditor.tsx` | shared UI component: InlineQtyEditor | 233 | ACTIVE |
| `src/components/shared/LiveQrScanner.tsx` | shared UI component: LiveQrScanner | 782 | ACTIVE |
| `src/components/shared/NumberStepper.tsx` | shared UI component: NumberStepper | 168 | ACTIVE |
| `src/components/shared/PageHeader.tsx` | shared UI component: PageHeader | 45 | ACTIVE |
| `src/components/shared/ProgressBar.tsx` | shared UI component: ProgressBar | 36 | ACTIVE |
| `src/components/shared/QueueDayTag.tsx` | shared UI component: QueueDayTag | 37 | ACTIVE |
| `src/components/shared/QueueSectionHeader.tsx` | shared UI component: QueueSectionHeader | 33 | ACTIVE |
| `src/components/shared/SalespersonSelectorSheet.tsx` | shared UI component: SalespersonSelectorSheet | 162 | ACTIVE |
| `src/components/shared/SearchInput.tsx` | shared UI component: SearchInput | 188 | ACTIVE |
| `src/components/shared/SearchableTransportDropdown.tsx` | shared UI component: SearchableTransportDropdown | 205 | ACTIVE |
| `src/components/shared/SelectTrigger.tsx` | shared UI component: SelectTrigger | 76 | ACTIVE |
| `src/components/shared/Skeleton.tsx` | shared UI component: Skeleton | 78 | ACTIVE |
| `src/components/shared/StatusBadge.tsx` | shared UI component: StatusBadge | 103 | ACTIVE |
| `src/components/shared/Toast.tsx` | shared UI component: Toast | 81 | ACTIVE |
| `src/components/shared/index.ts` | shared UI component: index | 23 | ACTIVE |
| `src/components/shared/scanner/CollectResultSheet.tsx` | shared UI component: CollectResultSheet | 169 | ACTIVE |
| `src/components/shared/scanner/PickScanLabResultSheet.tsx` | shared UI component: PickScanLabResultSheet | 155 | ACTIVE |
| `src/components/shared/scanner/ScannerControls.tsx` | shared UI component: ScannerControls | 71 | ACTIVE |
| `src/components/shared/scanner/ViewfinderOverlay.tsx` | shared UI component: ViewfinderOverlay | 130 | ACTIVE |
| `src/context/AuthContext.tsx` | React context/provider: AuthContext | 257 | ACTIVE |
| `src/context/CameraContext.tsx` | React context/provider: CameraContext | 291 | ACTIVE |
| `src/context/CartContext.tsx` | React context/provider: CartContext | 207 | ACTIVE |
| `src/context/OrderAuthorContext.tsx` | React context/provider: OrderAuthorContext | 52 | ACTIVE |
| `src/context/OrderRoutesContext.tsx` | React context/provider: OrderRoutesContext | 40 | ACTIVE |
| `src/context/ToastContext.tsx` | React context/provider: ToastContext | 96 | ACTIVE |
| `src/hooks/useAutoPickAssignment.ts` | React hook: useAutoPickAssignment | 122 | UNCLEAR |
| `src/hooks/useBillingCustomerUpdate.ts` | React hook: useBillingCustomerUpdate | 32 | ACTIVE |
| `src/hooks/useBillingFlow.ts` | React hook: useBillingFlow | 200 | ACTIVE |
| `src/hooks/useBillingFlowMachine.ts` | React hook: useBillingFlowMachine | 201 | ACTIVE |
| `src/hooks/useBillingStockFreshness.ts` | React hook: useBillingStockFreshness | 179 | ACTIVE |
| `src/hooks/useClaimableOrders.ts` | React hook: useClaimableOrders | 672 | ACTIVE |
| `src/hooks/useCopyToClipboard.ts` | React hook: useCopyToClipboard | 49 | ACTIVE |
| `src/hooks/useCustomers.ts` | React hook: useCustomers | 50 | ACTIVE |
| `src/hooks/useItems.ts` | React hook: useItems | 363 | ACTIVE |
| `src/hooks/useLocationwiseStock.ts` | React hook: useLocationwiseStock | 204 | ACTIVE |
| `src/hooks/useNotificationArrivalAlerts.ts` | React hook: useNotificationArrivalAlerts | 31 | UNCLEAR |
| `src/hooks/useOpenPoDemandLines.ts` | React hook: useOpenPoDemandLines | 296 | ACTIVE |
| `src/hooks/useOrderDetail.ts` | React hook: useOrderDetail | 179 | ACTIVE |
| `src/hooks/useOrders.ts` | React hook: useOrders | 190 | ACTIVE |
| `src/hooks/usePendingItems.ts` | React hook: usePendingItems | 52 | ACTIVE |
| `src/hooks/usePickerPushNotifications.ts` | React hook: usePickerPushNotifications | 4 | ACTIVE |
| `src/hooks/usePickingClaim.ts` | React hook: usePickingClaim | 50 | ACTIVE |
| `src/hooks/useQRScanner.ts` | React hook: useQRScanner | 923 | ACTIVE |
| `src/hooks/useRolePushNotifications.ts` | React hook: useRolePushNotifications | 297 | ACTIVE |
| `src/hooks/useSalesDashboard.ts` | React hook: useSalesDashboard | 202 | ACTIVE |
| `src/hooks/useSalesPendingRecovery.ts` | React hook: useSalesPendingRecovery | 465 | ACTIVE |
| `src/hooks/useSwipeReveal.ts` | React hook: useSwipeReveal | 162 | ACTIVE |
| `src/hooks/useTeamUsers.ts` | React hook: useTeamUsers | 24 | ACTIVE |
| `src/hooks/useTransports.ts` | React hook: useTransports | 20 | ACTIVE |
| `src/hooks/useUserNotifications.ts` | React hook: useUserNotifications | 133 | ACTIVE |
| `src/hooks/useUserStockLocation.ts` | React hook: useUserStockLocation | 61 | ACTIVE |
| `src/hooks/useWorkClaim.ts` | React hook: useWorkClaim | 219 | ACTIVE |
| `src/index.css` | Global Tailwind/design-token stylesheet | 770 | ACTIVE |
| `src/lib/abbreviations.ts` | Library/helper module for shared: abbreviations | 397 | ACTIVE |
| `src/lib/barcodeMapping.ts` | Library/helper module for shared: barcodeMapping | 357 | ACTIVE |
| `src/lib/billing/completeBilling.ts` | Library/helper module for billing: completeBilling | 91 | ACTIVE |
| `src/lib/billing/completeStalePicking.ts` | Library/helper module for billing: completeStalePicking | 84 | ACTIVE |
| `src/lib/billing/fulfillmentPath.ts` | Library/helper module for billing: fulfillmentPath | 41 | ACTIVE |
| `src/lib/billing/liveQueueDraft.ts` | Library/helper module for billing: liveQueueDraft | 181 | ACTIVE |
| `src/lib/billing/printPickingChalan.ts` | Library/helper module for billing: printPickingChalan | 109 | ACTIVE |
| `src/lib/billing/rejectionKind.ts` | Library/helper module for billing: rejectionKind | 34 | ACTIVE |
| `src/lib/buildBillingCustomerUpdate.ts` | Library/helper module for shared: buildBillingCustomerUpdate | 93 | ACTIVE |
| `src/lib/buildOrderCustomerMessage.ts` | Library/helper module for shared: buildOrderCustomerMessage | 136 | ACTIVE |
| `src/lib/buildPendingRecoveryCustomerMessage.ts` | Library/helper module for shared: buildPendingRecoveryCustomerMessage | 69 | ACTIVE |
| `src/lib/buildSalesCommunicateDraft.ts` | Library/helper module for shared: buildSalesCommunicateDraft | 39 | ACTIVE |
| `src/lib/cartDraftStorage.ts` | Library/helper module for shared: cartDraftStorage | 155 | ACTIVE |
| `src/lib/cartSupply.ts` | Library/helper module for shared: cartSupply | 130 | ACTIVE |
| `src/lib/crossTabSync.ts` | Library/helper module for shared: crossTabSync | 65 | ACTIVE |
| `src/lib/customerDisplay.ts` | Library/helper module for shared: customerDisplay | 49 | ACTIVE |
| `src/lib/haptics.ts` | Library/helper module for shared: haptics | 124 | ACTIVE |
| `src/lib/idb.ts` | Library/helper module for shared: idb | 77 | ACTIVE |
| `src/lib/import/customerImporter.ts` | Library/helper module for import: customerImporter | 139 | ACTIVE |
| `src/lib/import/fileDetector.ts` | Library/helper module for import: fileDetector | 223 | ACTIVE |
| `src/lib/import/itemImporter.ts` | Library/helper module for import: itemImporter | 256 | ACTIVE |
| `src/lib/import/packDefinitionsImporter.ts` | Library/helper module for import: packDefinitionsImporter | 297 | ACTIVE |
| `src/lib/import/purchasePoImporter.ts` | Library/helper module for import: purchasePoImporter | 594 | ACTIVE |
| `src/lib/import/salesHistoryImporter.ts` | Library/helper module for import: salesHistoryImporter | 370 | ACTIVE |
| `src/lib/import/salesTargetsImporter.ts` | Library/helper module for import: salesTargetsImporter | 293 | ACTIVE |
| `src/lib/import/stockImporter.ts` | Library/helper module for import: stockImporter | 209 | ACTIVE |
| `src/lib/import/transportImporter.ts` | Library/helper module for import: transportImporter | 145 | ACTIVE |
| `src/lib/labelStudio/computeLabelCountsFromRatio.ts` | Library/helper module for labelStudio: computeLabelCountsFromRatio | 131 | ACTIVE |
| `src/lib/labelStudio/computeLabelPlan.ts` | Library/helper module for labelStudio: computeLabelPlan | 88 | ACTIVE |
| `src/lib/labelStudio/resolveSupplier.ts` | Library/helper module for labelStudio: resolveSupplier | 68 | ACTIVE |
| `src/lib/labels/packStripPrint.ts` | Library/helper module for labels: packStripPrint | 105 | ACTIVE |
| `src/lib/notificationAlert.ts` | Library/helper module for shared: notificationAlert | 81 | ACTIVE |
| `src/lib/notificationDiagnostics.ts` | Library/helper module for shared: notificationDiagnostics | 183 | ACTIVE |
| `src/lib/ocr/gemini-extract.ts` | Library/helper module for ocr: gemini-extract | 119 | ACTIVE |
| `src/lib/ocr/geminiOCR.ts` | Library/helper module for ocr: geminiOCR | 16 | ACTIVE |
| `src/lib/ocr/matcher.ts` | Library/helper module for ocr: matcher | 406 | ACTIVE |
| `src/lib/ocr/normalizer.ts` | Library/helper module for ocr: normalizer | 204 | ACTIVE |
| `src/lib/ocr/pickVerifier.ts` | Library/helper module for ocr: pickVerifier | 46 | UNCLEAR |
| `src/lib/ocr/pipeline.ts` | Library/helper module for ocr: pipeline | 184 | ACTIVE |
| `src/lib/ocr/types.ts` | Library/helper module for ocr: types | 69 | ACTIVE |
| `src/lib/orderItemCount.ts` | Library/helper module for shared: orderItemCount | 191 | ACTIVE |
| `src/lib/packCatalog/buildPackCatalogRows.ts` | Library/helper module for packCatalog: buildPackCatalogRows | 60 | ACTIVE |
| `src/lib/packCatalog/derivePackHint.ts` | Library/helper module for packCatalog: derivePackHint | 1 | ACTIVE |
| `src/lib/packCatalog/exportPackCatalogCsv.ts` | Library/helper module for packCatalog: exportPackCatalogCsv | 79 | ACTIVE |
| `src/lib/packCatalog/filterPackCatalogRows.ts` | Library/helper module for packCatalog: filterPackCatalogRows | 53 | ACTIVE |
| `src/lib/packCatalog/matchParetoPlanItems.ts` | Library/helper module for packCatalog: matchParetoPlanItems | 99 | ACTIVE |
| `src/lib/packCatalog/matchStockStatusToItems.ts` | Library/helper module for packCatalog: matchStockStatusToItems | 131 | ACTIVE |
| `src/lib/packCatalog/operatorLabels.ts` | Library/helper module for packCatalog: operatorLabels | 59 | ACTIVE |
| `src/lib/packCatalog/parseBusyStockStatusCsv.ts` | Library/helper module for packCatalog: parseBusyStockStatusCsv | 146 | ACTIVE |
| `src/lib/packCatalog/parseLucasParetoPlan.ts` | Library/helper module for packCatalog: parseLucasParetoPlan | 73 | ACTIVE |
| `src/lib/packCatalog/precutSheetLayout.ts` | Library/helper module for packCatalog: precutSheetLayout | 302 | ACTIVE |
| `src/lib/packCatalog/printPackLabels.ts` | Library/helper module for packCatalog: printPackLabels | 324 | ACTIVE |
| `src/lib/packCatalog/printRackLabels.ts` | Library/helper module for packCatalog: printRackLabels | 236 | ACTIVE |
| `src/lib/packCatalog/saveItemRack.ts` | Library/helper module for packCatalog: saveItemRack | 13 | ACTIVE |
| `src/lib/packCatalog/savePackDefinition.ts` | Library/helper module for packCatalog: savePackDefinition | 68 | ACTIVE |
| `src/lib/packLpn.ts` | Library/helper module for shared: packLpn | 70 | ACTIVE |
| `src/lib/pendingRecovery.ts` | Library/helper module for shared: pendingRecovery | 44 | ACTIVE |
| `src/lib/pickQueueTransport.ts` | Library/helper module for shared: pickQueueTransport | 122 | ACTIVE |
| `src/lib/pickerPush.ts` | Library/helper module for shared: pickerPush | 73 | ACTIVE |
| `src/lib/picking/askBrand.ts` | Library/helper module for picking: askBrand | 17 | ACTIVE |
| `src/lib/picking/deckOrder.ts` | Library/helper module for picking: deckOrder | 69 | ACTIVE |
| `src/lib/picking/itemTransitionAdapter.ts` | Library/helper module for picking: itemTransitionAdapter | 91 | ACTIVE |
| `src/lib/picking/lucasBrand.ts` | Library/helper module for picking: lucasBrand | 23 | ACTIVE |
| `src/lib/picking/pickQueueBuckets.ts` | Library/helper module for picking: pickQueueBuckets | 8 | UNCLEAR |
| `src/lib/picking/pickQueueDisplay.ts` | Library/helper module for picking: pickQueueDisplay | 126 | ACTIVE |
| `src/lib/picking/tafeBrand.ts` | Library/helper module for picking: tafeBrand | 19 | ACTIVE |
| `src/lib/purchase/invoiceExtract.ts` | Library/helper module for purchase: invoiceExtract | 209 | ACTIVE |
| `src/lib/purchase/linkInvoiceLinesToPo.ts` | Library/helper module for purchase: linkInvoiceLinesToPo | 48 | ACTIVE |
| `src/lib/purchase/openPoDemand.ts` | Library/helper module for purchase: openPoDemand | 254 | ACTIVE |
| `src/lib/purchase/purchaseApi.ts` | Library/helper module for purchase: purchaseApi | 493 | ACTIVE |
| `src/lib/purchase/renderPdfToJpeg.ts` | Library/helper module for purchase: renderPdfToJpeg | 29 | ACTIVE |
| `src/lib/push.ts` | Library/helper module for shared: push | 93 | ACTIVE |
| `src/lib/queryClient.ts` | Library/helper module for shared: queryClient | 12 | ACTIVE |
| `src/lib/queueDayBuckets.ts` | Library/helper module for shared: queueDayBuckets | 157 | ACTIVE |
| `src/lib/realtime.ts` | Library/helper module for shared: realtime | 234 | ACTIVE |
| `src/lib/realtimePolicy.ts` | Library/helper module for shared: realtimePolicy | 27 | ACTIVE |
| `src/lib/receiving/derivePackFromCatalog.ts` | Library/helper module for receiving: derivePackFromCatalog | 74 | ACTIVE |
| `src/lib/receiving/receivingApi.ts` | Library/helper module for receiving: receivingApi | 436 | ACTIVE |
| `src/lib/receiving/receivingPrintErrors.ts` | Library/helper module for receiving: receivingPrintErrors | 24 | ACTIVE |
| `src/lib/receiving/receivingPrintUtils.ts` | Library/helper module for receiving: receivingPrintUtils | 423 | ACTIVE |
| `src/lib/receiving/receivingWorkflow.ts` | Library/helper module for receiving: receivingWorkflow | 165 | ACTIVE |
| `src/lib/scanner/acquireCamera.ts` | Library/helper module for scanner: acquireCamera | 96 | ACTIVE |
| `src/lib/scanner/barcodeFormats.ts` | Library/helper module for scanner: barcodeFormats | 16 | ACTIVE |
| `src/lib/scanner/barcodeParser.ts` | Library/helper module for scanner: barcodeParser | 449 | ACTIVE |
| `src/lib/scanner/deriveBusyCodeCandidates.ts` | Library/helper module for scanner: deriveBusyCodeCandidates | 14 | ACTIVE |
| `src/lib/scanner/feedback.ts` | Library/helper module for scanner: feedback | 167 | ACTIVE |
| `src/lib/scanner/labelPreprocess.ts` | Library/helper module for scanner: labelPreprocess | 170 | ACTIVE |
| `src/lib/scanner/liveQrScannerTypes.ts` | Library/helper module for scanner: liveQrScannerTypes | 32 | ACTIVE |
| `src/lib/scanner/oemBarcodeEngine.ts` | Library/helper module for scanner: oemBarcodeEngine | 175 | ACTIVE |
| `src/lib/scanner/pickBarcodeSelection.ts` | Library/helper module for scanner: pickBarcodeSelection | 196 | ACTIVE |
| `src/lib/scanner/pickScanQuantity.ts` | Library/helper module for scanner: pickScanQuantity | 108 | ACTIVE |
| `src/lib/scanner/qrMatch.ts` | Library/helper module for scanner: qrMatch | 91 | UNCLEAR |
| `src/lib/scanner/qrPayload.ts` | Library/helper module for scanner: qrPayload | 333 | ACTIVE |
| `src/lib/scanner/resolvePickedScan.ts` | Library/helper module for scanner: resolvePickedScan | 205 | ACTIVE |
| `src/lib/scanner/roiProcessor.ts` | Library/helper module for scanner: roiProcessor | 219 | ACTIVE |
| `src/lib/scanner/scannerDebug.ts` | Library/helper module for scanner: scannerDebug | 19 | ACTIVE |
| `src/lib/scanner/scannerPlatform.ts` | Library/helper module for scanner: scannerPlatform | 16 | ACTIVE |
| `src/lib/scanner/scoring.ts` | Library/helper module for scanner: scoring | 37 | ACTIVE |
| `src/lib/scanner/uomMapper.ts` | Library/helper module for scanner: uomMapper | 310 | ACTIVE |
| `src/lib/scanner/videoLoop.ts` | Library/helper module for scanner: videoLoop | 51 | ACTIVE |
| `src/lib/scanner/viewfinderCrop.ts` | Library/helper module for scanner: viewfinderCrop | 114 | ACTIVE |
| `src/lib/search/abbreviations.ts` | Library/helper module for search: abbreviations | 3 | ACTIVE |
| `src/lib/search/itemSearch.ts` | Library/helper module for search: itemSearch | 623 | ACTIVE |
| `src/lib/search/narrowSuggestions.ts` | Library/helper module for search: narrowSuggestions | 167 | ACTIVE |
| `src/lib/search/searchIndex.ts` | Library/helper module for search: searchIndex | 325 | ACTIVE |
| `src/lib/specialPricing.ts` | Library/helper module for shared: specialPricing | 54 | ACTIVE |
| `src/lib/stockDisplay.ts` | Library/helper module for shared: stockDisplay | 79 | ACTIVE |
| `src/lib/supabase/client.ts` | Library/helper module for supabase: client | 12 | ACTIVE |
| `src/lib/supabase/formatUserMessage.ts` | Library/helper module for supabase: formatUserMessage | 19 | ACTIVE |
| `src/lib/wms.ts` | Library/helper module for shared: wms | 147 | ACTIVE |
| `src/lib/wms/binLayers.ts` | Library/helper module for wms: binLayers | 108 | ACTIVE |
| `src/lib/wms/stagingBin.ts` | Library/helper module for wms: stagingBin | 16 | ACTIVE |
| `src/main.tsx` | React app bootstrap/providers | 30 | ACTIVE |
| `src/pages/LoginPage.tsx` | Route-level UI for Login page | 118 | ACTIVE |
| `src/pages/RoleSelectPage.tsx` | Route-level UI for RoleSelect page | 182 | ACTIVE |
| `src/pages/admin/AdminPage.tsx` | Route-level UI for Admin page | 276 | ACTIVE |
| `src/pages/admin/AdminPasscodePage.tsx` | Route-level UI for AdminPasscode page | 115 | ACTIVE |
| `src/pages/admin/BarcodeMappingPage.tsx` | Route-level UI for BarcodeMapping page | 1291 | ACTIVE |
| `src/pages/admin/BinOnboardingPage.tsx` | Route-level UI for BinOnboarding page | 1777 | ACTIVE |
| `src/pages/admin/CycleCountPage.tsx` | Route-level UI for CycleCount page | 1312 | ACTIVE |
| `src/pages/admin/LabelStudioPage.tsx` | Route-level UI for LabelStudio page | 2043 | ACTIVE |
| `src/pages/admin/OcrOrderLabPage.tsx` | Route-level UI for OcrOrderLab page | 244 | ACTIVE |
| `src/pages/admin/PackCatalogPage.tsx` | Route-level UI for PackCatalog page | 1077 | ACTIVE |
| `src/pages/admin/ParetoLabelPrintPage.tsx` | Route-level UI for ParetoLabelPrint page | 413 | ACTIVE |
| `src/pages/admin/PickScanLabPage.tsx` | Route-level UI for PickScanLab page | 994 | ACTIVE |
| `src/pages/admin/ProcessChallanPage.tsx` | Route-level UI for ProcessChallan page | 381 | ACTIVE |
| `src/pages/admin/StockAuditLabelPrintPage.tsx` | Route-level UI for StockAuditLabelPrint page | 421 | ACTIVE |
| `src/pages/admin/SupplyDemandPage.tsx` | Route-level UI for SupplyDemand page | 1473 | ACTIVE |
| `src/pages/admin/SupplyDemandSkuDetailPage.tsx` | Route-level UI for SupplyDemandSkuDetail page | 395 | ACTIVE |
| `src/pages/admin/UomOnboardingPage.tsx` | Route-level UI for UomOnboarding page | 495 | ACTIVE |
| `src/pages/admin/UploadPage.tsx` | Route-level UI for Upload page | 340 | ACTIVE |
| `src/pages/admin/binOnboardingHierarchy.ts` | Route-level UI for binOnboardingHierarchy | 169 | ACTIVE |
| `src/pages/admin/ocr-lab/OcrLabEditDrawer.tsx` | Route-level UI for OcrLabEditDrawer | 184 | ACTIVE |
| `src/pages/admin/ocr-lab/OcrLabHomeScreen.tsx` | Route-level UI for OcrLabHomeScreen | 86 | ACTIVE |
| `src/pages/admin/ocr-lab/OcrLabReviewScreen.tsx` | Route-level UI for OcrLabReviewScreen | 159 | ACTIVE |
| `src/pages/admin/ocr-lab/OcrLabScanningScreen.tsx` | Route-level UI for OcrLabScanningScreen | 33 | ACTIVE |
| `src/pages/admin/ocr-lab/OcrLabSummaryScreen.tsx` | Route-level UI for OcrLabSummaryScreen | 74 | ACTIVE |
| `src/pages/admin/ocr-lab/OcrLabUploadScreen.tsx` | Route-level UI for OcrLabUploadScreen | 104 | ACTIVE |
| `src/pages/admin/ocr-lab/helpers.ts` | Route-level UI for helpers | 111 | ACTIVE |
| `src/pages/admin/ocr-lab/types.ts` | Route-level UI for types | 53 | ACTIVE |
| `src/pages/admin/receiving/PutawayScanWizard.tsx` | Route-level UI for PutawayScanWizard | 667 | ACTIVE |
| `src/pages/admin/receiving/ReceivingJobDetailPage.tsx` | Route-level UI for ReceivingJobDetail page | 756 | ACTIVE |
| `src/pages/admin/receiving/ReceivingJobsPage.tsx` | Route-level UI for ReceivingJobs page | 285 | ACTIVE |
| `src/pages/admin/receiving/ReceivingSkuCard.tsx` | Route-level UI for ReceivingSkuCard | 429 | UNCLEAR |
| `src/pages/billing/BillingLayout.tsx` | Route-level UI for Billing layout | 116 | ACTIVE |
| `src/pages/billing/BillingNewOrderLayout.tsx` | Route-level UI for BillingNewOrder layout | 123 | ACTIVE |
| `src/pages/billing/CompactQueuePage.tsx` | Route-level UI for CompactQueue page | 964 | ACTIVE |
| `src/pages/billing/DashboardPage.tsx` | Route-level UI for Dashboard page | 388 | ACTIVE |
| `src/pages/billing/HistoryPage.tsx` | Route-level UI for History page | 370 | ACTIVE |
| `src/pages/billing/LiveQueue/AddLineSheet.tsx` | Route-level UI for AddLineSheet | 346 | ACTIVE |
| `src/pages/billing/LiveQueue/CommitView.tsx` | Route-level UI for CommitView | 201 | UNCLEAR |
| `src/pages/billing/LiveQueue/CommunicateView.tsx` | Route-level UI for CommunicateView | 102 | UNCLEAR |
| `src/pages/billing/LiveQueue/CompleteView.tsx` | Route-level UI for CompleteView | 35 | UNCLEAR |
| `src/pages/billing/LiveQueue/OrderSheetView.tsx` | Route-level UI for OrderSheetView | 1433 | ACTIVE |
| `src/pages/billing/LiveQueue/OrientView.tsx` | Route-level UI for OrientView | 60 | UNCLEAR |
| `src/pages/billing/LiveQueue/ProcessView.tsx` | Route-level UI for ProcessView | 439 | UNCLEAR |
| `src/pages/billing/LiveQueue/QueueView.tsx` | Route-level UI for QueueView | 431 | ACTIVE |
| `src/pages/billing/LiveQueue/ReportView.tsx` | Route-level UI for ReportView | 230 | ACTIVE |
| `src/pages/billing/LiveQueue/ResolveView.tsx` | Route-level UI for ResolveView | 120 | UNCLEAR |
| `src/pages/billing/LiveQueuePage.tsx` | Route-level UI for LiveQueue page | 963 | ACTIVE |
| `src/pages/billing/NeedsReviewPage.tsx` | Route-level UI for NeedsReview page | 146 | ACTIVE |
| `src/pages/billing/PendingPage.tsx` | Route-level UI for Pending page | 151 | ACTIVE |
| `src/pages/billing/RejectedPage.tsx` | Route-level UI for Rejected page | 377 | ACTIVE |
| `src/pages/billing/ReviewPage.tsx` | Route-level UI for Review page | 1462 | ACTIVE |
| `src/pages/picking/PickCompleteScreen.tsx` | Route-level UI for PickCompleteScreen | 89 | ACTIVE |
| `src/pages/picking/PickPage.tsx` | Route-level UI for Pick page | 2223 | ACTIVE |
| `src/pages/picking/PickPreviewPage.tsx` | Route-level UI for PickPreview page | 179 | ACTIVE |
| `src/pages/picking/PickingLayout.tsx` | Route-level UI for Picking layout | 83 | ACTIVE |
| `src/pages/picking/QueuePage.tsx` | Route-level UI for Queue page | 364 | ACTIVE |
| `src/pages/picking/QueueSheet.tsx` | Route-level UI for QueueSheet | 568 | ACTIVE |
| `src/pages/purchase/PurchaseHomePage.tsx` | Route-level UI for PurchaseHome page | 107 | ACTIVE |
| `src/pages/purchase/PurchaseInvoiceNewPage.tsx` | Route-level UI for PurchaseInvoiceNew page | 356 | ACTIVE |
| `src/pages/purchase/PurchaseInvoiceReviewPage.tsx` | Route-level UI for PurchaseInvoiceReview page | 362 | ACTIVE |
| `src/pages/purchase/PurchaseNewPoPage.tsx` | Route-level UI for PurchaseNewPo page | 213 | ACTIVE |
| `src/pages/purchase/PurchasePoDetailPage.tsx` | Route-level UI for PurchasePoDetail page | 246 | ACTIVE |
| `src/pages/purchase/PurchasePoPreviewTable.tsx` | Route-level UI for PurchasePoPreviewTable | 146 | ACTIVE |
| `src/pages/sales/CartPage.tsx` | Route-level UI for Cart page | 1805 | ACTIVE |
| `src/pages/sales/MyOrdersPage.tsx` | Route-level UI for MyOrders page | 1081 | ACTIVE |
| `src/pages/sales/NewOrderPage.tsx` | Route-level UI for NewOrder page | 2591 | ACTIVE |
| `src/pages/sales/PendingRecoveryPage.tsx` | Route-level UI for PendingRecovery page | 1295 | ACTIVE |
| `src/pages/sales/SalesChromeContext.tsx` | Route-level UI for SalesChromeContext | 37 | ACTIVE |
| `src/pages/sales/SalesEditAddLineSheet.tsx` | Route-level UI for SalesEditAddLineSheet | 346 | ACTIVE |
| `src/pages/sales/SalesHome.tsx` | Route-level UI for SalesHome | 353 | ACTIVE |
| `src/pages/sales/SalesLayout.tsx` | Route-level UI for Sales layout | 87 | ACTIVE |
| `src/stores/itemScanIndex.ts` | Client state store: itemScanIndex | 210 | ACTIVE |
| `src/sw.ts` | PWA service worker source | 102 | ACTIVE |
| `src/types/index.ts` | Shared TypeScript types: index | 551 | ACTIVE |
| `src/types/purchase.ts` | Shared TypeScript types: purchase | 63 | ACTIVE |
| `src/types/qrcode.d.ts` | TypeScript ambient declaration file | 21 | UNCLEAR |
| `src/types/receiving.ts` | Shared TypeScript types: receiving | 96 | ACTIVE |
| `src/utils/constants.ts` | Shared utility/constants: constants | 49 | ACTIVE |
| `src/utils/formatters.ts` | Shared utility/constants: formatters | 101 | ACTIVE |
| `src/utils/itemCodes.ts` | Shared utility/constants: itemCodes | 45 | ACTIVE |
| `src/workers/qrScanner.worker.ts` | Web worker: qrScanner.worker | 309 | UNCLEAR |

## SECTION 2 — DATA FLOW INVENTORY

### 2A. Supabase Tables in Use

Found **36** distinct `.from(...)` table names across `src/` and inspected Supabase functions/migrations.

| Table | Files querying it | Operations | Evidence |
|---|---|---|---|
| `app_config` | `src/context/AuthContext.tsx` | select | `src/context/AuthContext.tsx:137` |
| `billing_customer_updates` | `src/hooks/useBillingCustomerUpdate.ts`, `src/pages/billing/LiveQueuePage.tsx`, `src/pages/billing/ReviewPage.tsx` | insert, select | `src/hooks/useBillingCustomerUpdate.ts:19`, `src/pages/billing/LiveQueuePage.tsx:637`, `src/pages/billing/ReviewPage.tsx:519` |
| `bin_count_logs` | `src/lib/wms.ts` | select | `src/lib/wms.ts:55` |
| `bin_inventory` | `src/lib/barcodeMapping.ts`, `src/lib/wms.ts` | select | `src/lib/barcodeMapping.ts:129`, `src/lib/barcodeMapping.ts:196`, `src/lib/wms.ts:45` |
| `bin_inventory_layers` | `src/lib/receiving/receivingApi.ts` | select | `src/lib/receiving/receivingApi.ts:327` |
| `customer_top_items` | `src/lib/import/salesHistoryImporter.ts`, `src/lib/ocr/matcher.ts` | select, upsert | `src/lib/import/salesHistoryImporter.ts:304`, `src/lib/ocr/matcher.ts:210` |
| `customers` | `src/hooks/useClaimableOrders.ts`, `src/hooks/useCustomers.ts`, `src/hooks/useOrderDetail.ts`, `src/hooks/useSalesPendingRecovery.ts`, `src/lib/import/customerImporter.ts`, `src/lib/ocr/matcher.ts`, `src/lib/ocr/pipeline.ts`, `src/pages/sales/CartPage.tsx`, `src/pages/sales/NewOrderPage.tsx` | delete, insert, select, upsert | `src/hooks/useClaimableOrders.ts:224`, `src/hooks/useCustomers.ts:9`, `src/hooks/useCustomers.ts:20`, `src/hooks/useOrderDetail.ts:110`, `src/hooks/useSalesPendingRecovery.ts:342`, `src/lib/import/customerImporter.ts:63`, `src/lib/import/customerImporter.ts:103`, `src/lib/ocr/matcher.ts:199`, +5 more |
| `item_barcodes` | `src/lib/barcodeMapping.ts`, `src/lib/receiving/receivingApi.ts`, `src/stores/itemScanIndex.ts` | select | `src/lib/barcodeMapping.ts:318`, `src/lib/receiving/receivingApi.ts:8`, `src/stores/itemScanIndex.ts:121` |
| `item_pack_definitions` | `src/lib/barcodeMapping.ts`, `src/lib/packLpn.ts` | select | `src/lib/barcodeMapping.ts:302`, `src/lib/packLpn.ts:29` |
| `item_qr_tier_overrides` | `src/lib/scanner/uomMapper.ts` | upsert | `src/lib/scanner/uomMapper.ts:274` |
| `items` | `src/hooks/useItems.ts`, `src/hooks/useOpenPoDemandLines.ts`, `src/hooks/useSalesPendingRecovery.ts`, `src/lib/barcodeMapping.ts`, `src/lib/import/itemImporter.ts`, `src/lib/import/packDefinitionsImporter.ts`, `src/lib/import/purchasePoImporter.ts`, `src/lib/import/stockImporter.ts`, `src/lib/ocr/matcher.ts`, `src/lib/packCatalog/saveItemRack.ts`, `src/lib/purchase/purchaseApi.ts` | delete, select, update, upsert | `src/hooks/useItems.ts:240`, `src/hooks/useItems.ts:273`, `src/hooks/useOpenPoDemandLines.ts:277`, `src/hooks/useSalesPendingRecovery.ts:349`, `src/lib/barcodeMapping.ts:181`, `src/lib/barcodeMapping.ts:223`, `src/lib/barcodeMapping.ts:340`, `src/lib/import/itemImporter.ts:149`, +12 more |
| `license_plate_batches` | `src/lib/packLpn.ts` | update | `src/lib/packLpn.ts:58` |
| `license_plates` | `src/lib/packLpn.ts`, `src/lib/receiving/receivingApi.ts` | select, update | `src/lib/packLpn.ts:65`, `src/lib/receiving/receivingApi.ts:79`, `src/lib/receiving/receivingApi.ts:116` |
| `notification_events` | `supabase/functions/send-internal-notification/index.ts` | insert | `supabase/functions/send-internal-notification/index.ts:389`, `supabase/functions/send-internal-notification/index.ts:506`, `supabase/functions/send-internal-notification/index.ts:585` |
| `order_events` | `src/pages/billing/LiveQueuePage.tsx` | insert | `src/pages/billing/LiveQueuePage.tsx:449`, `src/pages/billing/LiveQueuePage.tsx:515` |
| `order_items` | `src/hooks/useOpenPoDemandLines.ts`, `src/hooks/useOrderDetail.ts`, `src/hooks/useSalesPendingRecovery.ts`, `src/lib/billing/liveQueueDraft.ts`, `src/lib/picking/itemTransitionAdapter.ts`, `src/pages/billing/CompactQueuePage.tsx`, `src/pages/billing/LiveQueuePage.tsx`, `src/pages/billing/ReviewPage.tsx`, `src/pages/picking/PickPage.tsx` | delete, insert, select, update | `src/hooks/useOpenPoDemandLines.ts:164`, `src/hooks/useOpenPoDemandLines.ts:176`, `src/hooks/useOpenPoDemandLines.ts:210`, `src/hooks/useOpenPoDemandLines.ts:217`, `src/hooks/useOrderDetail.ts:72`, `src/hooks/useSalesPendingRecovery.ts:356`, `src/lib/billing/liveQueueDraft.ts:151`, `src/lib/billing/liveQueueDraft.ts:176`, +9 more |
| `orders` | `src/hooks/useClaimableOrders.ts`, `src/hooks/useOpenPoDemandLines.ts`, `src/hooks/useOrderDetail.ts`, `src/hooks/useOrders.ts`, `src/hooks/useSalesDashboard.ts`, `src/hooks/useSalesPendingRecovery.ts`, `src/pages/billing/CompactQueuePage.tsx`, `src/pages/billing/LiveQueuePage.tsx`, `src/pages/billing/ReviewPage.tsx`, `src/pages/picking/PickPage.tsx`, `supabase/functions/send-internal-notification/index.ts` | select, update | `src/hooks/useClaimableOrders.ts:186`, `src/hooks/useOpenPoDemandLines.ts:187`, `src/hooks/useOpenPoDemandLines.ts:199`, `src/hooks/useOrderDetail.ts:64`, `src/hooks/useOrders.ts:107`, `src/hooks/useSalesDashboard.ts:162`, `src/hooks/useSalesDashboard.ts:176`, `src/hooks/useSalesPendingRecovery.ts:336`, +8 more |
| `pending_items` | `src/hooks/useOpenPoDemandLines.ts`, `src/hooks/usePendingItems.ts`, `src/hooks/useSalesPendingRecovery.ts`, `src/pages/billing/CompactQueuePage.tsx`, `src/pages/billing/LiveQueuePage.tsx`, `src/pages/billing/ReviewPage.tsx`, `src/pages/picking/PickPage.tsx`, `src/pages/sales/PendingRecoveryPage.tsx` | insert, select, update | `src/hooks/useOpenPoDemandLines.ts:240`, `src/hooks/useOpenPoDemandLines.ts:249`, `src/hooks/usePendingItems.ts:25`, `src/hooks/useSalesPendingRecovery.ts:298`, `src/pages/billing/CompactQueuePage.tsx:773`, `src/pages/billing/LiveQueuePage.tsx:464`, `src/pages/billing/LiveQueuePage.tsx:569`, `src/pages/billing/LiveQueuePage.tsx:602`, +12 more |
| `purchase_order_lines` | `src/lib/purchase/purchaseApi.ts` | insert, select, update | `src/lib/purchase/purchaseApi.ts:68`, `src/lib/purchase/purchaseApi.ts:140`, `src/lib/purchase/purchaseApi.ts:227`, `src/lib/purchase/purchaseApi.ts:307`, `src/lib/purchase/purchaseApi.ts:419` |
| `purchase_orders` | `src/lib/purchase/purchaseApi.ts` | insert, select, update | `src/lib/purchase/purchaseApi.ts:52`, `src/lib/purchase/purchaseApi.ts:61`, `src/lib/purchase/purchaseApi.ts:109`, `src/lib/purchase/purchaseApi.ts:200`, `src/lib/purchase/purchaseApi.ts:234`, `src/lib/purchase/purchaseApi.ts:239`, `src/lib/purchase/purchaseApi.ts:244`, `src/lib/purchase/purchaseApi.ts:394` |
| `push_subscriptions` | `src/hooks/useRolePushNotifications.ts`, `supabase/functions/send-internal-notification/index.ts` | select, update, upsert | `src/hooks/useRolePushNotifications.ts:65`, `src/hooks/useRolePushNotifications.ts:251`, `src/hooks/useRolePushNotifications.ts:259`, `supabase/functions/send-internal-notification/index.ts:194`, `supabase/functions/send-internal-notification/index.ts:257` |
| `receiving_job_lines` | `src/lib/receiving/receivingApi.ts` | delete, insert, select, update | `src/lib/receiving/receivingApi.ts:95`, `src/lib/receiving/receivingApi.ts:106`, `src/lib/receiving/receivingApi.ts:125`, `src/lib/receiving/receivingApi.ts:131`, `src/lib/receiving/receivingApi.ts:136` |
| `receiving_jobs` | `src/lib/purchase/purchaseApi.ts`, `src/lib/receiving/receivingApi.ts` | select | `src/lib/purchase/purchaseApi.ts:405`, `src/lib/receiving/receivingApi.ts:40`, `src/lib/receiving/receivingApi.ts:47` |
| `receiving_scan_events` | `src/lib/receiving/receivingApi.ts` | insert | `src/lib/receiving/receivingApi.ts:275` |
| `sales_targets` | `src/hooks/useSalesDashboard.ts`, `src/lib/import/salesTargetsImporter.ts` | insert, select, upsert | `src/hooks/useSalesDashboard.ts:63`, `src/hooks/useSalesDashboard.ts:127`, `src/lib/import/salesTargetsImporter.ts:249` |
| `salesperson_fy_sales` | `src/hooks/useSalesDashboard.ts`, `src/lib/import/salesHistoryImporter.ts` | select, upsert | `src/hooks/useSalesDashboard.ts:114`, `src/hooks/useSalesDashboard.ts:137`, `src/lib/import/salesHistoryImporter.ts:330` |
| `salesperson_product_group_sales` | `src/hooks/useSalesDashboard.ts`, `src/lib/import/salesHistoryImporter.ts` | insert, select, upsert | `src/hooks/useSalesDashboard.ts:76`, `src/lib/import/salesHistoryImporter.ts:343` |
| `salesperson_top_customers` | `src/lib/import/salesHistoryImporter.ts` | upsert | `src/lib/import/salesHistoryImporter.ts:317` |
| `stock_reservations` | `src/hooks/useBillingStockFreshness.ts` | select | `src/hooks/useBillingStockFreshness.ts:59` |
| `supplier_invoice_lines` | `src/lib/purchase/purchaseApi.ts` | insert, select, update | `src/lib/purchase/purchaseApi.ts:185`, `src/lib/purchase/purchaseApi.ts:301`, `src/lib/purchase/purchaseApi.ts:330` |
| `supplier_invoices` | `src/lib/purchase/purchaseApi.ts` | insert, select | `src/lib/purchase/purchaseApi.ts:151`, `src/lib/purchase/purchaseApi.ts:271`, `src/lib/purchase/purchaseApi.ts:318` |
| `transports` | `src/hooks/useTransports.ts`, `src/lib/import/transportImporter.ts` | delete, select, upsert | `src/hooks/useTransports.ts:10`, `src/lib/import/transportImporter.ts:74`, `src/lib/import/transportImporter.ts:109` |
| `upload_log` | `src/lib/import/customerImporter.ts`, `src/lib/import/itemImporter.ts`, `src/lib/import/packDefinitionsImporter.ts`, `src/lib/import/salesHistoryImporter.ts`, `src/lib/import/salesTargetsImporter.ts`, `src/lib/import/stockImporter.ts`, `src/lib/import/transportImporter.ts` | insert | `src/lib/import/customerImporter.ts:126`, `src/lib/import/itemImporter.ts:243`, `src/lib/import/packDefinitionsImporter.ts:276`, `src/lib/import/salesHistoryImporter.ts:351`, `src/lib/import/salesTargetsImporter.ts:216`, `src/lib/import/salesTargetsImporter.ts:255`, `src/lib/import/salesTargetsImporter.ts:265`, `src/lib/import/stockImporter.ts:196`, +1 more |
| `user_notifications` | `src/hooks/useUserNotifications.ts`, `src/lib/notificationDiagnostics.ts`, `supabase/functions/send-internal-notification/index.ts` | insert, select, update | `src/hooks/useUserNotifications.ts:27`, `src/hooks/useUserNotifications.ts:96`, `src/hooks/useUserNotifications.ts:115`, `src/lib/notificationDiagnostics.ts:140`, `src/lib/notificationDiagnostics.ts:160`, `supabase/functions/send-internal-notification/index.ts:184` |
| `users` | `src/context/AuthContext.tsx`, `src/hooks/useSalesPendingRecovery.ts`, `src/hooks/useTeamUsers.ts`, `src/hooks/useUserStockLocation.ts`, `supabase/functions/send-internal-notification/index.ts` | select | `src/context/AuthContext.tsx:117`, `src/context/AuthContext.tsx:175`, `src/hooks/useSalesPendingRecovery.ts:372`, `src/hooks/useTeamUsers.ts:14`, `src/hooks/useUserStockLocation.ts:32`, `src/hooks/useUserStockLocation.ts:46`, `supabase/functions/send-internal-notification/index.ts:120`, `supabase/functions/send-internal-notification/index.ts:139`, +1 more |
| `work_claims` | `src/hooks/useClaimableOrders.ts`, `src/hooks/usePickingClaim.ts`, `src/pages/billing/DashboardPage.tsx` | select | `src/hooks/useClaimableOrders.ts:238`, `src/hooks/usePickingClaim.ts:22`, `src/pages/billing/DashboardPage.tsx:249` |

RPC calls observed (not table `.from` calls):
- `add_billing_line` at `src/pages/billing/LiveQueue/AddLineSheet.tsx:127` — `const { data, error } = await supabase.rpc('add_billing_line', {`
- `add_sales_submitted_line` at `src/pages/sales/SalesEditAddLineSheet.tsx:126` — `const { data, error } = await supabase.rpc('add_sales_submitted_line', {`
- `assign_next_picking_order` at `src/hooks/useAutoPickAssignment.ts:53` — `const { data, error } = await supabase.rpc('assign_next_picking_order', {`
- `billing_complete_stale_picking` at `src/lib/billing/completeStalePicking.ts:18` — `const { data, error } = await supabase.rpc('billing_complete_stale_picking', {`
- `billing_force_complete_pre_pick` at `src/lib/billing/completeStalePicking.ts:55` — `const { data, error } = await supabase.rpc('billing_force_complete_pre_pick', {`
- `bulk_import_bin_inventory` at `src/lib/wms.ts:119` — `const { data, error } = await supabase.rpc('bulk_import_bin_inventory', {`
- `claim_order` at `src/hooks/useWorkClaim.ts:147` — `const { data, error: rpcError } = await supabase.rpc('claim_order', {`
- `claim_order` at `src/pages/picking/QueuePage.tsx:96` — `const { data, error } = await supabase.rpc('claim_order', {`
- `complete_billing` at `src/lib/billing/completeBilling.ts:47` — `const { data, error } = await supabase.rpc('complete_billing', {`
- `complete_picking` at `src/pages/picking/PickPage.tsx:853` — `const { error } = await supabase.rpc('complete_picking', {`
- `create_license_plate_batch` at `src/lib/packLpn.ts:46` — `const { data, error } = await supabase.rpc('create_license_plate_batch', {`
- `create_pending_recovery_order` at `src/pages/sales/PendingRecoveryPage.tsx:708` — `const { data, error } = await supabase.rpc('create_pending_recovery_order', {`
- `create_receiving_job_from_invoice` at `src/lib/purchase/purchaseApi.ts:348` — `const { data, error } = await supabase.rpc('create_receiving_job_from_invoice', {`
- `create_receiving_job_from_purchase_order` at `src/lib/purchase/purchaseApi.ts:470` — `const { data, error } = await supabase.rpc('create_receiving_job_from_purchase_order', {`
- `create_receiving_job_manual_arrival` at `src/lib/receiving/receivingApi.ts:22` — `const { data, error } = await supabase.rpc('create_receiving_job_manual_arrival', {`
- `get_barcode_coverage` at `src/lib/barcodeMapping.ts:262` — `const { data, error } = await supabase.rpc('get_barcode_coverage');`
- `get_barcode_rack_coverage` at `src/lib/barcodeMapping.ts:268` — `const { data, error } = await supabase.rpc('get_barcode_rack_coverage');`
- `get_billing_queue_snapshot` at `src/hooks/useClaimableOrders.ts:289` — `const { data, error } = await supabase.rpc('get_billing_queue_snapshot', {`
- `get_customer_quick_reorder_stats` at `src/pages/sales/NewOrderPage.tsx:368` — `const { data, error } = await supabase.rpc('get_customer_quick_reorder_stats', {`
- `get_locationwise_stock_for_busy_codes` at `src/hooks/useLocationwiseStock.ts:129` — `const { data, error } = await supabase.rpc('get_locationwise_stock_for_busy_codes', {`
- `get_salesperson_top_customers_live` at `src/pages/sales/NewOrderPage.tsx:319` — `const { data, error } = await supabase.rpc('get_salesperson_top_customers_live', {`
- `get_trending_items_live` at `src/pages/sales/NewOrderPage.tsx:332` — `const { data, error } = await supabase.rpc('get_trending_items_live', { p_limit: 5 });`
- `heartbeat_claim` at `src/hooks/useWorkClaim.ts:90` — `const { data, error: rpcError } = await supabase.rpc('heartbeat_claim', {`
- `hold_order_for_account_lock` at `src/pages/billing/LiveQueuePage.tsx:723` — `const { data, error } = await supabase.rpc('hold_order_for_account_lock', {`
- `list_uom_coverage_gaps` at `src/lib/scanner/uomMapper.ts:292` — `const { data, error } = await supabase.rpc('list_uom_coverage_gaps', {`
- `process_pending_recovery_action` at `src/pages/sales/MyOrdersPage.tsx:479` — `const { error } = await supabase.rpc('process_pending_recovery_action', {`
- `receiving_apply_inner_break` at `src/lib/receiving/receivingApi.ts:245` — `const { data, error } = await supabase.rpc('receiving_apply_inner_break', {`
- `receiving_apply_inner_overflow` at `src/lib/receiving/receivingApi.ts:226` — `const { data, error } = await supabase.rpc('receiving_apply_inner_overflow', {`
- `receiving_confirm_dock_arrival` at `src/lib/receiving/receivingApi.ts:62` — `const { data, error } = await supabase.rpc('receiving_confirm_dock_arrival', {`
- `receiving_invalidate_license_plate_before_reprint` at `src/lib/receiving/receivingApi.ts:257` — `const { data, error } = await supabase.rpc('receiving_invalidate_license_plate_before_reprint', {`
- `receiving_print_inner_labels` at `src/lib/receiving/receivingApi.ts:205` — `const { data, error } = await supabase.rpc('receiving_print_inner_labels', {`
- `receiving_print_master_labels` at `src/lib/receiving/receivingApi.ts:190` — `const { data, error } = await supabase.rpc('receiving_print_master_labels', {`
- `receiving_putaway_inner_whole` at `src/lib/receiving/receivingApi.ts:344` — `const { data, error } = await supabase.rpc('receiving_putaway_inner_whole', {`
- `receiving_putaway_to_bin_bulk` at `src/lib/receiving/receivingApi.ts:371` — `const { data, error } = await supabase.rpc('receiving_putaway_to_bin_bulk', {`
- `receiving_putaway_to_bin_each_scan` at `src/lib/receiving/receivingApi.ts:400` — `const { data, error } = await supabase.rpc('receiving_putaway_to_bin_each_scan', {`
- `receiving_resolve_lp_scan` at `src/lib/receiving/receivingApi.ts:288` — `const { data, error } = await supabase.rpc('receiving_resolve_lp_scan', {`
- `receiving_try_roll_up_po_for_job_line` at `src/lib/receiving/receivingApi.ts:426` — `const { data, error } = await supabase.rpc('receiving_try_roll_up_po_for_job_line', {`
- `release_claim` at `src/hooks/useWorkClaim.ts:185` — `await supabase.rpc('release_claim', {`
- `release_claim` at `src/hooks/useWorkClaim.ts:204` — `void supabase.rpc('release_claim', {`
- `remove_sales_submitted_line` at `src/pages/sales/MyOrdersPage.tsx:511` — `const { data, error } = await supabase.rpc('remove_sales_submitted_line', {`
- `resolve_scan_to_uom` at `src/lib/scanner/uomMapper.ts:128` — `const { data, error } = await supabase.rpc('resolve_scan_to_uom', {`
- `review_bin_count` at `src/lib/wms.ts:96` — `const { data, error } = await supabase.rpc('review_bin_count', {`
- `revive_billing_order` at `src/pages/billing/HistoryPage.tsx:164` — `const { data, error: rpcError } = await supabase.rpc('revive_billing_order', {`
- `revive_billing_order` at `src/pages/billing/RejectedPage.tsx:149` — `const { data, error: rpcError } = await supabase.rpc('revive_billing_order', {`
- `save_barcode_mapping` at `src/lib/barcodeMapping.ts:245` — `const { data, error } = await supabase.rpc('save_barcode_mapping', {`
- `seed_bin_inventory_from_items` at `src/lib/wms.ts:139` — `const { data, error } = await supabase.rpc('seed_bin_inventory_from_items', {`
- `submit_bin_count` at `src/lib/wms.ts:65` — `const { data, error } = await supabase.rpc('submit_bin_count', {`
- `submit_sales_order` at `src/pages/sales/CartPage.tsx:1183` — `const { data: rpcData, error: rpcError } = await supabase.rpc('submit_sales_order', {`
- `upsert_item_pack_definitions` at `src/lib/import/packDefinitionsImporter.ts:248` — `const { data, error } = await supabase.rpc('upsert_item_pack_definitions', {`
- `upsert_item_pack_definitions` at `src/lib/packCatalog/savePackDefinition.ts:14` — `const { error } = await supabase.rpc('upsert_item_pack_definitions', {`
- `upsert_item_pack_definitions` at `src/lib/receiving/receivingApi.ts:173` — `const { error } = await supabase.rpc('upsert_item_pack_definitions', {`
- `upsert_uom_definition` at `src/pages/admin/BinOnboardingPage.tsx:714` — `const { data, error } = await supabase.rpc('upsert_uom_definition', {`
- `upsert_uom_definition` at `src/pages/admin/UomOnboardingPage.tsx:208` — `const { data, error } = await supabase.rpc('upsert_uom_definition', {`
- `wms_consume_bin_layer_for_pick` at `src/lib/wms/binLayers.ts:80` — `const { data, error } = await supabase.rpc('wms_consume_bin_layer_for_pick', {`
- `wms_get_bin_picker_shelf` at `src/lib/wms/binLayers.ts:29` — `const { data, error } = await supabase.rpc('wms_get_bin_picker_shelf', {`
- `wms_promote_staging_layer` at `src/lib/receiving/receivingApi.ts:314` — `const { data, error } = await supabase.rpc('wms_promote_staging_layer', {`

### 2B. Data Fetching Patterns

- TanStack `useQuery` occurrences: **135**. `useMutation` occurrences: **85**. Query-key/invalidation references: **231**.
- Query key references:
  - `src/components/admin/StagingPromotePanel.tsx:24` — `queryKey: ['stagingLayers', busyCode], queryFn: () => fetchStagingLayersForBusy(busyCode), enabled: Number.isFinite(busyCode) && busyCode > 0, });  if (isStagingBinId(targetBinId)) return null;`
  - `src/components/admin/StagingPromotePanel.tsx:73` — `void qc.invalidateQueries({ queryKey: ['stagingLayers', busyCode] }); } catch { toast.error('Move failed'); } finally { setMovingId(null); }`
  - `src/hooks/useAutoPickAssignment.ts:60` — `void queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); navigate(`/picking/pick/${result.order_id}`, { replace: true }); return result; }  if (result.reason === 'queue_empty') {`
  - `src/hooks/useBillingCustomerUpdate.ts:14` — `queryKey: ['billing-customer-update', options.orderId ?? 'none'], queryFn: async () => { if (typeof options.orderId !== 'number') return null;  const { data, error } = await supabase .from('billing_customer_updates')`
  - `src/hooks/useBillingStockFreshness.ts:166` — `queryKey: ['billing-stock-freshness', orderId, busyCodes.join(','), loc, sig], enabled: orderId != null && busyCodes.length > 0, staleTime: 15_000, refetchInterval: 30_000, refetchIntervalInBackground: false, queryFn: as`
  - `src/hooks/useClaimableOrders.ts:384` — `const queryKey = useMemo( () => [ 'claimable-orders', stage, statusKey, todayOnly ?? false,`
  - `src/hooks/useClaimableOrders.ts:396` — `queryKey, queryFn: async () => { if (!billingEventsEnabled) { return fetchLegacyClaimableOrders(options, userId); }`
  - `src/hooks/useClaimableOrders.ts:435` — `void queryClient.invalidateQueries({ queryKey }); };  if (!REALTIME_ON) { setBillingStatus('disabled'); return;`
  - `src/hooks/useClaimableOrders.ts:605` — `queryKey, stage, statusKey, todayOnly, workflowStatus, ]);`
  - `src/hooks/useCustomers.ts:46` — `queryKey: ['customers'], queryFn: fetchAllCustomers, staleTime: 30 * 60 * 1000, }); }`
  - `src/hooks/useItems.ts:299` — `export const ITEMS_QUERY_KEY = ['items'] as const;`
  - `src/hooks/useItems.ts:326` — `queryKey: ITEMS_QUERY_KEY, queryFn: fetchAllItems, /** * Align stale window with the stock poll so focus events do not refetch the * full catalog while data is still considered fresh — cuts redundant DB * traffic while k`
  - `src/hooks/useItems.ts:359` — `queryKey: ITEMS_QUERY_KEY, queryFn: fetchAllItems, staleTime: STOCK_SYNC_INTERVAL_MS, }); }`
  - `src/hooks/useLocationwiseStock.ts:72` — `await queryClient.invalidateQueries({ queryKey: ['stock_locationwise'] }); }  export function snapshotLocationwiseStockFromCache(busyCodes: number[]): Record<number, ItemLocationStock> { const out: Record<number, ItemLoc`
  - `src/hooks/useLocationwiseStock.ts:191` — `queryKey: ['stock_locationwise', busyCodesKey], queryFn: () => fetchLocationwiseStock(normalizedBusyCodes), enabled: normalizedBusyCodes.length > 0, staleTime: POLL_INTERVAL_MS, placeholderData: () => { const cached = sn`
  - `src/hooks/useOpenPoDemandLines.ts:234` — `queryKey: ['open-po-demand-lines'], queryFn: async () => { const orderLines = await fetchOpenOrderItemLines();  let pendingRaw: PendingItem[] \| null = null; let pendingResult = await supabase`
  - `src/hooks/useOrderDetail.ts:58` — `const queryKey = ['order', orderId] as const;  const query = useQuery<OrderWithItems>({ queryKey, queryFn: async () => { const { data: order, error: orderError } = await supabase`
  - `src/hooks/useOrderDetail.ts:61` — `queryKey, queryFn: async () => { const { data: order, error: orderError } = await supabase .from('orders') .select('*') .eq('id', orderId!)`
  - `src/hooks/useOrderDetail.ts:149` — `void queryClient.invalidateQueries({ queryKey: ['order', orderId] }); }, REALTIME_DEBOUNCE_MS); };  const unsubOrder = subscribeToTable({ channelName: `order-detail:${orderId}`,`
  - `src/hooks/useOrderDetail.ts:159` — `queryClient.invalidateQueries({ queryKey: ['order', orderId] }), });  const unsubItems = subscribeToTable({ channelName: `order-items:${orderId}`, table: 'order_items',`
  - `src/hooks/useOrderDetail.ts:168` — `queryClient.invalidateQueries({ queryKey: ['order', orderId] }), });  return () => { if (debounceRef.current) clearTimeout(debounceRef.current); unsubOrder();`
  - `src/hooks/useOrders.ts:70` — `const queryKey = useMemo( () => [ 'orders', opts.status ?? 'all', opts.salespersonName ?? 'all',`
  - `src/hooks/useOrders.ts:100` — `queryKey, queryFn: async () => { const todayIso = getTodayStartIso();  const sort = opts.sort ?? 'newest-first'; const orderAsc = sort === 'oldest-first';`
  - `src/hooks/useOrders.ts:161` — `void queryClient.invalidateQueries({ queryKey }); }, REALTIME_DEBOUNCE_MS); };  const ordersFilter = opts.status && !opts.overdueOnly`
  - `src/hooks/useOrders.ts:171` — `channelName: `orders-list:${queryKey.join('\|')}`, table: 'orders', filter: ordersFilter, onChange: scheduleInvalidate, onReconnect: () => queryClient.invalidateQueries({ queryKey }), });`
  - `src/hooks/useOrders.ts:175` — `onReconnect: () => queryClient.invalidateQueries({ queryKey }), });  return () => { if (debounceRef.current) clearTimeout(debounceRef.current); unsub();`
  - `src/hooks/useOrders.ts:182` — `}, [queryClient, queryKey, opts.status, opts.overdueOnly]);  return result; }  /** Returns submitted orders created before today (overdue), sorted newest first by default */`
  - `src/hooks/usePendingItems.ts:17` — `queryKey: [ 'pending-items', opts.status ?? 'all', opts.orderId ?? 'all', opts.customerId ?? 'all', opts.recoveryStatuses?.join(',') ?? 'all',`
  - `src/hooks/usePickingClaim.ts:18` — `queryKey: ['picking-claim', orderId], enabled: orderId != null && enabled, queryFn: async () => { const { data, error } = await supabase .from('work_claims') .select(`
  - `src/hooks/useSalesDashboard.ts:46` — `queryKey: ['sales-dashboard', salespersonName], queryFn: async () => { if (!salespersonName) { return { annualTargetLakhs: 0, fyAchievement: 0,`
  - `src/hooks/useSalesPendingRecovery.ts:293` — `queryKey: ['sales-pending-recovery', userId ?? 'name', userName ?? 'unknown'], queryFn: async () => { if (!userName) return [];  const { data: pendingItems, error: pendingError } = await supabase .from('pending_items')`
  - `src/hooks/useTeamUsers.ts:11` — `queryKey: ['users', role ?? 'all'], queryFn: async () => { let q = supabase .from('users') .select('*') .eq('is_active', true);`
  - `src/hooks/useTransports.ts:7` — `queryKey: ['transports'], queryFn: async () => { const { data, error } = await supabase .from('transports') .select('*') .eq('is_active', true)`
  - `src/hooks/useUserStockLocation.ts:28` — `queryKey: ['user-stock-location', userId ?? 'name', userName ?? 'unknown'], queryFn: async () => { if (userId != null) { const { data, error } = await supabase .from('users') .select('stock_location_code')`
  - `src/lib/crossTabSync.ts:15` — `\| { kind: 'invalidate'; queryKey: readonly unknown[] } \| { kind: 'items-changed' };  const CHANNEL_NAME = 'paspl-cross-tab-sync';  let channel: BroadcastChannel \| null = null;`
  - `src/lib/crossTabSync.ts:32` — `void queryClient.invalidateQueries({ queryKey: msg.queryKey }); } else if (msg.kind === 'items-changed') { void queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }); } } catch { // ignore — never break the app fr`
  - `src/lib/crossTabSync.ts:34` — `void queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }); } } catch { // ignore — never break the app from a sync handler } });`
  - `src/lib/crossTabSync.ts:63` — `export function broadcastInvalidate(queryKey: readonly unknown[]): void { post({ kind: 'invalidate', queryKey }); }`
  - `src/lib/crossTabSync.ts:64` — `post({ kind: 'invalidate', queryKey }); }`
  - `src/lib/packLpn.ts:11` — `export const PACK_DEFINITIONS_QUERY_KEY = ['item-pack-definitions'] as const;`
  - `src/lib/purchase/purchaseApi.ts:10` — `export const PURCHASE_ORDERS_QUERY_KEY = ['purchase', 'orders'] as const;`
  - `src/lib/purchase/purchaseApi.ts:373` — `export const RECEIVING_HUB_POS_QUERY_KEY = ['purchase', 'receiving-hub', 'sent-pos'] as const;`
  - `src/lib/receiving/receivingApi.ts:4` — `export const RECEIVING_JOBS_QUERY_KEY = ['receiving', 'jobs'] as const;`
  - `src/lib/scanner/barcodeParser.ts:215` — `const queryKeys = [ 'code', 'item', 'sku', 'alias', 'alias1',`
  - `src/lib/scanner/barcodeParser.ts:231` — `const fromQuery = queryKeys .map((k) => url.searchParams.get(k)?.trim() ?? '') .filter(Boolean) .map((v) => v.toUpperCase());  const fromPath = (url.pathname.match(/[A-Z0-9][A-Z0-9.\-]{3,}/gi) ?? []).map((v) => v.toUpper`
  - `src/lib/wms.ts:4` — `export const BIN_INVENTORY_QUERY_KEY = ['wms', 'bin-inventory'] as const;`
  - `src/lib/wms.ts:5` — `export const PENDING_BIN_COUNTS_QUERY_KEY = ['wms', 'pending-bin-counts'] as const;`
  - `src/pages/admin/BarcodeMappingPage.tsx:68` — `const BARCODE_COVERAGE_QUERY_KEY = ['barcode-coverage'] as const;`
  - `src/pages/admin/BarcodeMappingPage.tsx:69` — `const BARCODE_RACK_COVERAGE_QUERY_KEY = ['barcode-rack-coverage'] as const;`
  - `src/pages/admin/BarcodeMappingPage.tsx:70` — `const MAPPED_SKUS_QUERY_KEY = ['barcode-mapped-skus'] as const;`
  - `src/pages/admin/BarcodeMappingPage.tsx:267` — `queryKey: BARCODE_COVERAGE_QUERY_KEY, queryFn: fetchBarcodeCoverage, staleTime: 30_000, }); const { data: rackCoverage, isLoading: rackCoverageLoading } = useQuery({ queryKey: BARCODE_RACK_COVERAGE_QUERY_KEY,`
  - `src/pages/admin/BarcodeMappingPage.tsx:272` — `queryKey: BARCODE_RACK_COVERAGE_QUERY_KEY, queryFn: fetchBarcodeRackCoverage, staleTime: 30_000, }); const { data: mappedSkuSummaries = [] } = useQuery({ queryKey: MAPPED_SKUS_QUERY_KEY,`
  - `src/pages/admin/BarcodeMappingPage.tsx:277` — `queryKey: MAPPED_SKUS_QUERY_KEY, queryFn: fetchMappedSkuSummaries, staleTime: 30_000, }); const mappedSkuSet = useMemo( () => new Set(mappedSkuSummaries.map((entry) => entry.skuBusyCode)),`
  - `src/pages/admin/BarcodeMappingPage.tsx:368` — `void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_QUERY_KEY }); toast.info('Multiple SKUs found in this bin. Choose the one you are mapping.'); } catch (error) { const message = error instanceof Error ? error.me`
  - `src/pages/admin/BarcodeMappingPage.tsx:479` — `void queryClient.invalidateQueries({ queryKey: BARCODE_COVERAGE_QUERY_KEY }); void queryClient.invalidateQueries({ queryKey: BARCODE_RACK_COVERAGE_QUERY_KEY }); void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_`
  - `src/pages/admin/BarcodeMappingPage.tsx:480` — `void queryClient.invalidateQueries({ queryKey: BARCODE_RACK_COVERAGE_QUERY_KEY }); void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_QUERY_KEY });  // Patch the live scan index so the scanner resolves this barco`
  - `src/pages/admin/BarcodeMappingPage.tsx:481` — `void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_QUERY_KEY });  // Patch the live scan index so the scanner resolves this barcode immediately // in the current browser session without waiting for a full index r`
  - `src/pages/admin/BinOnboardingPage.tsx:59` — `const SHELF_ROW_QUERY_KEY = 'bin-onboarding-shelf-row' as const;`
  - `src/pages/admin/BinOnboardingPage.tsx:306` — `await queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY }); await queryClient.invalidateQueries({ queryKey: BIN_INVENTORY_QUERY_KEY }); setQuickPlaceBin(''); setQuickPlaceSkuBusy(''); }, onError: () =>`
  - `src/pages/admin/BinOnboardingPage.tsx:307` — `await queryClient.invalidateQueries({ queryKey: BIN_INVENTORY_QUERY_KEY }); setQuickPlaceBin(''); setQuickPlaceSkuBusy(''); }, onError: () => toast.error('Could not assign bin.'), });`
  - `src/pages/admin/BinOnboardingPage.tsx:342` — `queryKey: ['bin-pack-defs', currentBinId, busyCodesInBin.slice().sort().join(',')], queryFn: () => fetchPackDefsForBusyCodes(busyCodesInBin), enabled: busyCodesInBin.length > 0, });  const {`
  - `src/pages/admin/BinOnboardingPage.tsx:351` — `queryKey: [SHELF_ROW_QUERY_KEY, currentBinId], queryFn: () => fetchShelfSiblingBinIds(currentBinId!), enabled: shelfRowPatternMatched, staleTime: 120_000, });`
  - `src/pages/admin/BinOnboardingPage.tsx:373` — `queryKey: MAPPED_SKUS_KEY, queryFn: fetchMappedSkuSummaries, staleTime: 60_000, });  const mappedSkuSet = useMemo(() => {`
  - `src/pages/admin/BinOnboardingPage.tsx:387` — `queryKey: BARCODE_COV_KEY, queryFn: fetchBarcodeCoverage, staleTime: 60_000, });  const { data: uomGaps = [] } = useQuery({`
  - `src/pages/admin/BinOnboardingPage.tsx:393` — `queryKey: UOM_GAPS_KEY, queryFn: () => fetchUomCoverageGaps(5000), staleTime: 60_000, });  const activeBusyCodesTotal = useMemo(() => {`
  - `src/pages/admin/BinOnboardingPage.tsx:599` — `void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_KEY }); setScannerOpen(null); toast.success(`${tier} label saved (${displayKey}).`); }, [ selectedSku,`
  - `src/pages/admin/BinOnboardingPage.tsx:666` — `void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_KEY }); toast.success(`${tier} label forced for this SKU (${displayKey}).`); }, [tierConflict, selectedSku, manufacturer, userId, userName, toast, queryClient]);`
  - `src/pages/admin/BinOnboardingPage.tsx:737` — `queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: ['bin-pack-defs', currentBinId, busyCodesInBin.slice().sort().join(',')], }), queryClient.invalidateQueri`
  - `src/pages/admin/BinOnboardingPage.tsx:739` — `queryKey: ['bin-pack-defs', currentBinId, busyCodesInBin.slice().sort().join(',')], }), queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: UOM_GAPS_KEY }), queryClient`
  - `src/pages/admin/BinOnboardingPage.tsx:741` — `queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: UOM_GAPS_KEY }), queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_KEY }), ]);  setSessionStats((s) => ({`
  - `src/pages/admin/BinOnboardingPage.tsx:742` — `queryClient.invalidateQueries({ queryKey: UOM_GAPS_KEY }), queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_KEY }), ]);  setSessionStats((s) => ({ ...s,`
  - `src/pages/admin/BinOnboardingPage.tsx:743` — `queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_KEY }), ]);  setSessionStats((s) => ({ ...s, uomConfirmed: s.uomConfirmed + (wasConfirmed ? 0 : 1),`
  - `src/pages/admin/CycleCountPage.tsx:309` — `queryKey: BIN_INVENTORY_QUERY_KEY, queryFn: fetchBinInventory, });  const { data: pendingCounts = [], isLoading: pendingLoading } = useQuery({ queryKey: PENDING_BIN_COUNTS_QUERY_KEY,`
  - `src/pages/admin/CycleCountPage.tsx:314` — `queryKey: PENDING_BIN_COUNTS_QUERY_KEY, queryFn: fetchPendingBinCounts, });  const { data: packDefinitions = [] } = useQuery({ queryKey: PACK_DEFINITIONS_QUERY_KEY,`
  - `src/pages/admin/CycleCountPage.tsx:319` — `queryKey: PACK_DEFINITIONS_QUERY_KEY, queryFn: fetchItemPackDefinitions, });  const binBySlot = useMemo(() => { const map = new Map<string, BinInventory>();`
  - `src/pages/admin/CycleCountPage.tsx:383` — `queryClient.invalidateQueries({ queryKey: BIN_INVENTORY_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: PENDING_BIN_COUNTS_QUERY_KEY }), ]); };  const countMutation = useMutation({`
  - `src/pages/admin/CycleCountPage.tsx:384` — `queryClient.invalidateQueries({ queryKey: PENDING_BIN_COUNTS_QUERY_KEY }), ]); };  const countMutation = useMutation({ mutationFn: submitBinCount,`
  - `src/pages/admin/LabelStudioPage.tsx:630` — `queryKey: PACK_DEFINITIONS_QUERY_KEY, queryFn: fetchItemPackDefinitions, });  const [labelMode, setLabelMode] = useState<LabelMode>('sku'); const [query, setQuery] = useState('');`
  - `src/pages/admin/PackCatalogPage.tsx:233` — `queryKey: PACK_DEFINITIONS_QUERY_KEY, queryFn: fetchItemPackDefinitions, });  const allRows = useMemo( () => buildPackCatalogRows(items, packQuery.data ?? []),`
  - `src/pages/admin/PackCatalogPage.tsx:313` — `await queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY }); toast.success('Pack sizes saved'); setEditRow(null); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } finally`
  - `src/pages/admin/PackCatalogPage.tsx:435` — `await queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY }); setImportResult(result); toast.success(formatImportSummary(result)); } catch (e) { toast.error(e instanceof Error ? e.message : 'Import faile`
  - `src/pages/admin/PackCatalogPage.tsx:455` — `await queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }); toast.success(value ? 'Rack saved' : 'Rack cleared'); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save rack'); throw e; }`
  - `src/pages/admin/PackCatalogPage.tsx:481` — `await queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY }); toast.success(field === 'outer' ? 'Outer box saved' : 'Inner box saved'); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could n`
  - `src/pages/admin/PickScanLabPage.tsx:126` — `queryKey: PACK_DEFINITIONS_QUERY_KEY, queryFn: fetchItemPackDefinitions, }); const [query, setQuery] = useState(''); const [liveTarget, setLiveTarget] = useState<ScanLabRecord \| null>(null); const [targetQty, setTargetQt`
  - `src/pages/admin/ProcessChallanPage.tsx:30` — `const BARCODE_COVERAGE_QUERY_KEY = ['barcode-coverage'] as const;`
  - `src/pages/admin/ProcessChallanPage.tsx:31` — `const BARCODE_RACK_COVERAGE_QUERY_KEY = ['barcode-rack-coverage'] as const;`
  - `src/pages/admin/ProcessChallanPage.tsx:32` — `const MAPPED_SKUS_QUERY_KEY = ['barcode-mapped-skus'] as const;`
  - `src/pages/admin/ProcessChallanPage.tsx:213` — `queryClient.invalidateQueries({ queryKey: BARCODE_COVERAGE_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: BARCODE_RACK_COVERAGE_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_QUERY_KEY }), ]`
  - `src/pages/admin/ProcessChallanPage.tsx:214` — `queryClient.invalidateQueries({ queryKey: BARCODE_RACK_COVERAGE_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_QUERY_KEY }), ]); toast.success(`Saved ${ok} mapping(s). ${fail ? `${fail} failed.` : ''`
  - `src/pages/admin/ProcessChallanPage.tsx:215` — `queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_QUERY_KEY }), ]); toast.success(`Saved ${ok} mapping(s). ${fail ? `${fail} failed.` : ''}`); setBulkSaving(false); }, [saveableRows, toast, queryClient, updateRow, us`
  - `src/pages/admin/SupplyDemandPage.tsx:687` — `queryClient.invalidateQueries({ queryKey: ['open-po-demand-lines'] }); queryClient.invalidateQueries({ queryKey: ['pending-items'] }); };  const copyWithToast = async (text: string, id: string, successMessage: string) =>`
  - `src/pages/admin/SupplyDemandPage.tsx:688` — `queryClient.invalidateQueries({ queryKey: ['pending-items'] }); };  const copyWithToast = async (text: string, id: string, successMessage: string) => { const ok = await copy(text, id); if (ok) toast.success(successMessag`
  - `src/pages/admin/UomOnboardingPage.tsx:21` — `const UOM_COVERAGE_QUERY_KEY = ['uom-coverage-gaps'] as const;`
  - `src/pages/admin/UomOnboardingPage.tsx:62` — `queryKey: PACK_DEFINITIONS_QUERY_KEY, queryFn: fetchItemPackDefinitions, });  const packDefinitionByBusyCode = useMemo(() => { const map = new Map<number, (typeof packDefinitions)[0]>();`
  - `src/pages/admin/UomOnboardingPage.tsx:77` — `queryKey: UOM_COVERAGE_QUERY_KEY, queryFn: () => fetchUomCoverageGaps(800), });  const filteredCoverage = useMemo(() => { const q = coverageQuery.trim().toLowerCase();`
  - `src/pages/admin/UomOnboardingPage.tsx:228` — `void queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY }); void queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }); void queryClient.invalidateQueries({ queryKey: UOM_COVERAGE_QUERY_KEY }); v`
  - `src/pages/admin/UomOnboardingPage.tsx:229` — `void queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }); void queryClient.invalidateQueries({ queryKey: UOM_COVERAGE_QUERY_KEY }); void refetchCoverage(); }, onError: (e: Error) => { toast.error(e.message \|\| 'C`
  - `src/pages/admin/UomOnboardingPage.tsx:230` — `void queryClient.invalidateQueries({ queryKey: UOM_COVERAGE_QUERY_KEY }); void refetchCoverage(); }, onError: (e: Error) => { toast.error(e.message \|\| 'Could not save.'); },`
  - `src/pages/admin/UploadPage.tsx:111` — `void queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }); broadcastItemsChanged(); } if (detection.type === 'item_pack_definitions') { void queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY })`
  - `src/pages/admin/UploadPage.tsx:115` — `void queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY }); } if (detection.type === 'transports') { void queryClient.invalidateQueries({ queryKey: ['transports'] }); }`
  - `src/pages/admin/UploadPage.tsx:118` — `void queryClient.invalidateQueries({ queryKey: ['transports'] }); }  // Invalidate dashboard + smart suggestions when targets or sales history change if (detection.type === 'sales_plan') { // Sales targets updated – refr`
  - `src/pages/admin/UploadPage.tsx:124` — `void queryClient.invalidateQueries({ queryKey: ['sales-dashboard'] }); } if (detection.type === 'sales_history') { // Sales history aggregates updated – refresh dashboard & frequently bought data void queryClient.invalid`
  - `src/pages/admin/UploadPage.tsx:128` — `void queryClient.invalidateQueries({ queryKey: ['sales-dashboard'] }); void queryClient.invalidateQueries({ queryKey: ['salesperson_top_customers'] }); void queryClient.invalidateQueries({ queryKey: ['trending_items'] })`
  - `src/pages/admin/UploadPage.tsx:129` — `void queryClient.invalidateQueries({ queryKey: ['salesperson_top_customers'] }); void queryClient.invalidateQueries({ queryKey: ['trending_items'] }); void queryClient.invalidateQueries({ queryKey: ['customer_quick_reord`
  - `src/pages/admin/UploadPage.tsx:130` — `void queryClient.invalidateQueries({ queryKey: ['trending_items'] }); void queryClient.invalidateQueries({ queryKey: ['customer_quick_reorder'] }); } if (result.failedCount > 0) { toast.info( `Import finished. ${result.p`
  - `src/pages/admin/UploadPage.tsx:131` — `void queryClient.invalidateQueries({ queryKey: ['customer_quick_reorder'] }); } if (result.failedCount > 0) { toast.info( `Import finished. ${result.processed.toLocaleString()} ${detection.type === 'sales_plan' ? 'target`
  - `src/pages/admin/receiving/ReceivingJobDetailPage.tsx:76` — `queryKey: ['receiving', 'job', jobId], queryFn: () => fetchReceivingJob(jobId), enabled: Number.isFinite(jobId) && jobId > 0, });  const linesQuery = useQuery({`
  - `src/pages/admin/receiving/ReceivingJobDetailPage.tsx:82` — `queryKey: linesKey(jobId), queryFn: () => fetchJobLines(jobId), enabled: Number.isFinite(jobId) && jobId > 0, });  const platesQuery = useQuery({`
  - `src/pages/admin/receiving/ReceivingJobDetailPage.tsx:88` — `queryKey: ['receiving', 'plates', jobId], queryFn: () => fetchLicensePlatesForJob(jobId), enabled: Number.isFinite(jobId) && jobId > 0, });  const packQuery = useQuery({`
  - `src/pages/admin/receiving/ReceivingJobDetailPage.tsx:94` — `queryKey: PACK_DEFINITIONS_QUERY_KEY, queryFn: fetchItemPackDefinitions, });  const packByBusy = useMemo(() => { const m = new Map<number, ItemPackDefinition>();`
  - `src/pages/admin/receiving/ReceivingJobDetailPage.tsx:141` — `void qc.invalidateQueries({ queryKey: linesKey(jobId) }); void qc.invalidateQueries({ queryKey: ['receiving', 'plates', jobId] }); void qc.invalidateQueries({ queryKey: ['receiving', 'job', jobId] }); };  const dockMut =`
  - `src/pages/admin/receiving/ReceivingJobDetailPage.tsx:142` — `void qc.invalidateQueries({ queryKey: ['receiving', 'plates', jobId] }); void qc.invalidateQueries({ queryKey: ['receiving', 'job', jobId] }); };  const dockMut = useMutation({ mutationFn: () =>`
  - `src/pages/admin/receiving/ReceivingJobDetailPage.tsx:143` — `void qc.invalidateQueries({ queryKey: ['receiving', 'job', jobId] }); };  const dockMut = useMutation({ mutationFn: () => confirmDockArrival({`
  - `src/pages/admin/receiving/ReceivingJobDetailPage.tsx:161` — `void qc.invalidateQueries({ queryKey: ['receiving', 'job', jobId] }); setStep('count'); }, onError: () => toast.error('Could not confirm dock'), });`
  - `src/pages/admin/receiving/ReceivingJobsPage.tsx:46` — `queryKey: RECEIVING_HUB_POS_QUERY_KEY, queryFn: fetchSentPurchaseOrdersForReceivingHub, });  const jobsQuery = useQuery({ queryKey: RECEIVING_JOBS_QUERY_KEY,`
  - `src/pages/admin/receiving/ReceivingJobsPage.tsx:51` — `queryKey: RECEIVING_JOBS_QUERY_KEY, queryFn: () => fetchReceivingJobs(40), });  const jobIds = useMemo(() => (jobsQuery.data ?? []).map((j) => j.id), [jobsQuery.data]);`
  - `src/pages/admin/receiving/ReceivingJobsPage.tsx:58` — `queryKey: ['receiving', 'hub-lines', jobIds.join(',')], queryFn: () => fetchJobLinesForJobIds(jobIds), enabled: jobIds.length > 0, });  const openJobs = useMemo(() => {`
  - `src/pages/admin/receiving/ReceivingJobsPage.tsx:83` — `await qc.invalidateQueries({ queryKey: RECEIVING_JOBS_QUERY_KEY }); toast.success(`Job ${r.job_public_id}`); navigate(`/admin/receiving/${r.receiving_job_id}?step=truck`); }, onError: () => toast.error('Could not create`
  - `src/pages/admin/receiving/ReceivingJobsPage.tsx:93` — `await qc.invalidateQueries({ queryKey: RECEIVING_JOBS_QUERY_KEY }); await qc.invalidateQueries({ queryKey: RECEIVING_HUB_POS_QUERY_KEY }); toast.success(`Receiving ${r.job_public_id}`); navigate(`/admin/receiving/${r.rec`
  - `src/pages/admin/receiving/ReceivingJobsPage.tsx:94` — `await qc.invalidateQueries({ queryKey: RECEIVING_HUB_POS_QUERY_KEY }); toast.success(`Receiving ${r.job_public_id}`); navigate(`/admin/receiving/${r.receiving_job_id}?step=truck`); }, onError: (e: Error) => toast.error(e`
  - `src/pages/billing/CompactQueuePage.tsx:727` — `queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); toast.info(`Order ${order?.order_number} parked.`); handleSkip(); }, onError: () => toast.error(`
  - `src/pages/billing/CompactQueuePage.tsx:728` — `queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); toast.info(`Order ${order?.order_number} parked.`); handleSkip(); }, onError: () => toast.error('Failed to park order'), });`
  - `src/pages/billing/CompactQueuePage.tsx:840` — `queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); queryClient.invalidateQueries({ queryKey: ['order', effectiveOrderId] }); void invalidateLocatio`
  - `src/pages/billing/CompactQueuePage.tsx:841` — `queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); queryClient.invalidateQueries({ queryKey: ['order', effectiveOrderId] }); void invalidateLocationwiseStockQueries(queryClient); machine.confirmCommunicat`
  - `src/pages/billing/CompactQueuePage.tsx:842` — `queryClient.invalidateQueries({ queryKey: ['order', effectiveOrderId] }); void invalidateLocationwiseStockQueries(queryClient); machine.confirmCommunication(); }, onError: () => toast.error('Failed to approve order'), })`
  - `src/pages/billing/DashboardPage.tsx:245` — `queryKey: ['picking-claims-stale', pickingOrderIds.join(',')], enabled: pickingOrderIds.length > 0, queryFn: async () => { const { data, error } = await supabase .from('work_claims') .select('order_id, last_heartbeat_at'`
  - `src/pages/billing/HistoryPage.tsx:194` — `queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); queryClient.invalidateQueries({ queryKey: ['order', target.id] }); void invalidateLocationwiseSt`
  - `src/pages/billing/HistoryPage.tsx:195` — `queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); queryClient.invalidateQueries({ queryKey: ['order', target.id] }); void invalidateLocationwiseStockQueries(queryClient);  await sendInternalNotification(`
  - `src/pages/billing/HistoryPage.tsx:196` — `queryClient.invalidateQueries({ queryKey: ['order', target.id] }); void invalidateLocationwiseStockQueries(queryClient);  await sendInternalNotification({ eventType: 'order_update_for_sales', orderId: target.id,`
  - `src/pages/billing/LiveQueue/AddLineSheet.tsx:160` — `void queryClient.invalidateQueries({ queryKey: ['order', orderId] }); void queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); void queryClient.invalidateQueries({ queryKey: ['billing-stock-freshness'] });`
  - `src/pages/billing/LiveQueue/AddLineSheet.tsx:161` — `void queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); void queryClient.invalidateQueries({ queryKey: ['billing-stock-freshness'] }); void invalidateLocationwiseStockQueries(queryClient); onAdded(orderIt`
  - `src/pages/billing/LiveQueue/AddLineSheet.tsx:162` — `void queryClient.invalidateQueries({ queryKey: ['billing-stock-freshness'] }); void invalidateLocationwiseStockQueries(queryClient); onAdded(orderItemId); onClose(); }, onError: (err: unknown) => {`
  - `src/pages/billing/LiveQueuePage.tsx:226` — `void queryClient.invalidateQueries({ queryKey: ['order', oid] }); void queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); } }, [queryClient, toast]);  const handleApplyLiveStock = useCallback(`
  - `src/pages/billing/LiveQueuePage.tsx:227` — `void queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); } }, [queryClient, toast]);  const handleApplyLiveStock = useCallback( async (orderItemId: number, liveCapacity: number) => {`
  - `src/pages/billing/LiveQueuePage.tsx:269` — `await queryClient.invalidateQueries({ queryKey: ['order', o.id] }); await queryClient.invalidateQueries({ queryKey: ['billing-stock-freshness'] }); }, [queryClient, toast], );`
  - `src/pages/billing/LiveQueuePage.tsx:270` — `await queryClient.invalidateQueries({ queryKey: ['billing-stock-freshness'] }); }, [queryClient, toast], );  // Reset sheet hydration when the targeted order changes`
  - `src/pages/billing/LiveQueuePage.tsx:690` — `queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); queryClient.invalidateQueries({ queryKey: ['order', snapshot.orderId] }); void invalidateLocatio`
  - `src/pages/billing/LiveQueuePage.tsx:691` — `queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); queryClient.invalidateQueries({ queryKey: ['order', snapshot.orderId] }); void invalidateLocationwiseStockQueries(queryClient); queryClient.invalidateQue`
  - `src/pages/billing/LiveQueuePage.tsx:692` — `queryClient.invalidateQueries({ queryKey: ['order', snapshot.orderId] }); void invalidateLocationwiseStockQueries(queryClient); queryClient.invalidateQueries({ queryKey: ['billing-stock-freshness'] });  // Move to report`
  - `src/pages/billing/LiveQueuePage.tsx:694` — `queryClient.invalidateQueries({ queryKey: ['billing-stock-freshness'] });  // Move to report screen flow.finishBilling(); }, onError: (err: unknown) => {`
  - `src/pages/billing/LiveQueuePage.tsx:772` — `queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); void invalidateLocationwiseStockQueries(queryClient); if (order) { queryClient.invalidateQueries`
  - `src/pages/billing/LiveQueuePage.tsx:773` — `queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); void invalidateLocationwiseStockQueries(queryClient); if (order) { queryClient.invalidateQueries({ queryKey: ['order', order.id] }); } toast.success(`
  - `src/pages/billing/LiveQueuePage.tsx:776` — `queryClient.invalidateQueries({ queryKey: ['order', order.id] }); } toast.success( kind === 'account_hold' ? 'Order on hold (account locked) — sales notified' : 'Order rejected and salesperson notified',`
  - `src/pages/billing/RejectedPage.tsx:179` — `queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); queryClient.invalidateQueries({ queryKey: ['order', target.id] }); void invalidateLocationwiseSt`
  - `src/pages/billing/RejectedPage.tsx:180` — `queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); queryClient.invalidateQueries({ queryKey: ['order', target.id] }); void invalidateLocationwiseStockQueries(queryClient);  await sendInternalNotification(`
  - `src/pages/billing/RejectedPage.tsx:181` — `queryClient.invalidateQueries({ queryKey: ['order', target.id] }); void invalidateLocationwiseStockQueries(queryClient);  await sendInternalNotification({ eventType: 'order_update_for_sales', orderId: target.id,`
  - `src/pages/billing/ReviewPage.tsx:615` — `queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQueries({ queryKey: ['order', orderId] }); queryClient.invalidateQueries({ queryKey: ['pending-items'] }); queryClient.invalidateQueries({ qu`
  - `src/pages/billing/ReviewPage.tsx:616` — `queryClient.invalidateQueries({ queryKey: ['order', orderId] }); queryClient.invalidateQueries({ queryKey: ['pending-items'] }); queryClient.invalidateQueries({ queryKey: ['open-po-demand-lines'] }); void invalidateLocat`
  - `src/pages/billing/ReviewPage.tsx:617` — `queryClient.invalidateQueries({ queryKey: ['pending-items'] }); queryClient.invalidateQueries({ queryKey: ['open-po-demand-lines'] }); void invalidateLocationwiseStockQueries(queryClient); queryClient.invalidateQueries({`
  - `src/pages/billing/ReviewPage.tsx:618` — `queryClient.invalidateQueries({ queryKey: ['open-po-demand-lines'] }); void invalidateLocationwiseStockQueries(queryClient); queryClient.invalidateQueries({ queryKey: ['billing-customer-update', orderId] }); toast.succes`
  - `src/pages/billing/ReviewPage.tsx:620` — `queryClient.invalidateQueries({ queryKey: ['billing-customer-update', orderId] }); toast.success( order?.workflow_status === 'flagged' ? 'Flags resolved and order marked completed' : fulfillmentPath === 'warehouse_pick'`
  - `src/pages/billing/ReviewPage.tsx:654` — `queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQueries({ queryKey: ['order', orderId] }); void invalidateLocationwiseStockQueries(queryClient); toast.success('Order rejected', { action: {`
  - `src/pages/billing/ReviewPage.tsx:655` — `queryClient.invalidateQueries({ queryKey: ['order', orderId] }); void invalidateLocationwiseStockQueries(queryClient); toast.success('Order rejected', { action: { label: 'Undo', onClick: () => {`
  - `src/pages/billing/ReviewPage.tsx:673` — `queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQueries({ queryKey: ['order', orderId] }); void invalidateLocationwiseStockQueries(queryClient); toast.success('Rejection undone'); }); },`
  - `src/pages/billing/ReviewPage.tsx:674` — `queryClient.invalidateQueries({ queryKey: ['order', orderId] }); void invalidateLocationwiseStockQueries(queryClient); toast.success('Rejection undone'); }); }, },`
  - `src/pages/billing/ReviewPage.tsx:723` — `queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQueries({ queryKey: ['order', orderId] }); queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); queryClient.invalidateQueries({`
  - `src/pages/billing/ReviewPage.tsx:724` — `queryClient.invalidateQueries({ queryKey: ['order', orderId] }); queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); queryClient.invalidateQueries({ queryKey: ['picking-claim', orderId] }); toast.success(`
  - `src/pages/billing/ReviewPage.tsx:725` — `queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); queryClient.invalidateQueries({ queryKey: ['picking-claim', orderId] }); toast.success( result.has_flags ? 'Order completed with flagged lines — review a`
  - `src/pages/billing/ReviewPage.tsx:726` — `queryClient.invalidateQueries({ queryKey: ['picking-claim', orderId] }); toast.success( result.has_flags ? 'Order completed with flagged lines — review and generate bill' : 'Order marked completed', );`
  - `src/pages/billing/ReviewPage.tsx:753` — `queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQueries({ queryKey: ['order', orderId] }); queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); toast.success('Order completed`
  - `src/pages/billing/ReviewPage.tsx:754` — `queryClient.invalidateQueries({ queryKey: ['order', orderId] }); queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); toast.success('Order completed without warehouse pick'); }, onError: (err: unknown) => {`
  - `src/pages/billing/ReviewPage.tsx:755` — `queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); toast.success('Order completed without warehouse pick'); }, onError: (err: unknown) => { toast.error(err instanceof Error ? err.message : 'Failed to comp`
  - `src/pages/picking/PickPage.tsx:369` — `queryKey: PACK_DEFINITIONS_QUERY_KEY, queryFn: fetchItemPackDefinitions, staleTime: 5 * 60 * 1000, }); const packDefinitionByBusyCode = useMemo( () => new Map(packDefinitions.map((row) => [row.busy_code, row])),`
  - `src/pages/picking/PickPage.tsx:704` — `queryKey: ['pickerShelf', shelfBinId, shelfBusy], queryFn: () => fetchBinPickerShelf(shelfBinId!, shelfBusy!), enabled: Boolean(shelfBinId && shelfBusy != null), });  useEffect(() => {`
  - `src/pages/picking/PickPage.tsx:806` — `queryClient.invalidateQueries({ queryKey: ['order', orderId] }); }, });  const tryConsumeShelfStock = useCallback( async (`
  - `src/pages/picking/PickPage.tsx:831` — `void queryClient.invalidateQueries({ queryKey: ['pickerShelf', bin, busy] }); return 'ok'; } if (res.reason === 'override_reason_required') { return 'override_blocked'; }`
  - `src/pages/picking/PickPage.tsx:883` — `queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQueries({ queryKey: ['order', orderId] }); appHaptics.success(); setShowComplete(true); }, onError: () => {`
  - `src/pages/picking/PickPage.tsx:884` — `queryClient.invalidateQueries({ queryKey: ['order', orderId] }); appHaptics.success(); setShowComplete(true); }, onError: () => { toast.error('Failed to complete order');`
  - `src/pages/picking/PickPage.tsx:942` — `queryClient.invalidateQueries({ queryKey: ['order', orderId] }); appHaptics.impactLight(); toast.info(`Undid ${snapshot.itemName}. Pick it again or skip.`); } catch { toast.error('Could not undo. Refresh and try again.')`
  - `src/pages/picking/PickPage.tsx:1459` — `void queryClient.invalidateQueries({ queryKey: ['pickerShelf', b, busy] }); } const reasonSnap = fifoOverrideReason.trim(); setFifoOverrideSheet(null); setFifoOverrideReason(''); if (sheet.resume === 'manual') {`
  - `src/pages/picking/QueuePage.tsx:112` — `queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); navigate(`/picking/pick/${claimedOrderId}`, { replace: true }); }, onError: (err) => { const msg = err instanceof Error ? err.message : ''; if (msg.start`
  - `src/pages/picking/QueuePage.tsx:127` — `queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); if (claimOrderIdParam) { clearNotificationIntent(); } }, });`
  - `src/pages/purchase/PurchaseHomePage.tsx:10` — `queryKey: PURCHASE_ORDERS_QUERY_KEY, queryFn: () => fetchPurchaseOrders(), }); const rows = ordersQuery.data ?? [];  return (`
  - `src/pages/purchase/PurchaseInvoiceNewPage.tsx:36` — `queryKey: ['purchase', 'lookup_maps'], queryFn: fetchPurchaseLookupMaps, staleTime: 5 * 60 * 1000, });  const onPickPdf = useCallback(`
  - `src/pages/purchase/PurchaseInvoiceNewPage.tsx:107` — `await qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY }); await qc.invalidateQueries({ queryKey: purchaseOrderDetailKey(r.purchase_order_id) }); await qc.invalidateQueries({ queryKey: ['purchase', 'po', r.purc`
  - `src/pages/purchase/PurchaseInvoiceNewPage.tsx:108` — `await qc.invalidateQueries({ queryKey: purchaseOrderDetailKey(r.purchase_order_id) }); await qc.invalidateQueries({ queryKey: ['purchase', 'po', r.purchase_order_id, 'lines'] }); await qc.invalidateQueries({ queryKey: ['`
  - `src/pages/purchase/PurchaseInvoiceNewPage.tsx:109` — `await qc.invalidateQueries({ queryKey: ['purchase', 'po', r.purchase_order_id, 'lines'] }); await qc.invalidateQueries({ queryKey: ['purchase', 'po', r.purchase_order_id, 'latest_invoice'] }); toast.success(`Saved · ${r.`
  - `src/pages/purchase/PurchaseInvoiceNewPage.tsx:110` — `await qc.invalidateQueries({ queryKey: ['purchase', 'po', r.purchase_order_id, 'latest_invoice'] }); toast.success(`Saved · ${r.po_number}`); }, onError: (e: Error) => toast.error(e.message \|\| 'Could not create PO from i`
  - `src/pages/purchase/PurchaseInvoiceNewPage.tsx:123` — `await qc.invalidateQueries({ queryKey: RECEIVING_JOBS_QUERY_KEY }); toast.success(`Receiving ${r.job_public_id}`); navigate(`/admin/receiving/${r.receiving_job_id}`); }, onError: (e: Error) => toast.error(e.message \|\| 'C`
  - `src/pages/purchase/PurchaseInvoiceReviewPage.tsx:39` — `queryKey: purchaseOrderDetailKey(poId), queryFn: () => fetchPurchaseOrder(poId), enabled: Number.isFinite(poId) && poId > 0, });  const linesQuery = useQuery({`
  - `src/pages/purchase/PurchaseInvoiceReviewPage.tsx:45` — `queryKey: purchaseOrderLinesKey(poId), queryFn: () => fetchPurchaseOrderLines(poId), enabled: Number.isFinite(poId) && poId > 0, });  const mapsQuery = useQuery({`
  - `src/pages/purchase/PurchaseInvoiceReviewPage.tsx:51` — `queryKey: ['purchase', 'lookup_maps'], queryFn: fetchPurchaseLookupMaps, staleTime: 5 * 60 * 1000, });  const onPickPdf = useCallback(`
  - `src/pages/purchase/PurchaseInvoiceReviewPage.tsx:119` — `await qc.invalidateQueries({ queryKey: purchaseOrderDetailKey(poId) }); await qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY }); await qc.invalidateQueries({ queryKey: ['purchase', 'po', poId, 'latest_invoice`
  - `src/pages/purchase/PurchaseInvoiceReviewPage.tsx:120` — `await qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY }); await qc.invalidateQueries({ queryKey: ['purchase', 'po', poId, 'latest_invoice'] }); toast.success('Invoice saved'); }, onError: () => toast.error('Co`
  - `src/pages/purchase/PurchaseInvoiceReviewPage.tsx:121` — `await qc.invalidateQueries({ queryKey: ['purchase', 'po', poId, 'latest_invoice'] }); toast.success('Invoice saved'); }, onError: () => toast.error('Could not save invoice'), });`
  - `src/pages/purchase/PurchaseInvoiceReviewPage.tsx:134` — `await qc.invalidateQueries({ queryKey: RECEIVING_JOBS_QUERY_KEY }); toast.success(`Receiving ${r.job_public_id}`); navigate(`/admin/receiving/${r.receiving_job_id}`); }, onError: (e: Error) => toast.error(e.message \|\| 'C`
  - `src/pages/purchase/PurchaseNewPoPage.tsx:113` — `await qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY }); await qc.invalidateQueries({ queryKey: purchaseOrderDetailKey(r.purchase_order_id) }); await qc.invalidateQueries({ queryKey: purchaseOrderLinesKey(r.p`
  - `src/pages/purchase/PurchaseNewPoPage.tsx:114` — `await qc.invalidateQueries({ queryKey: purchaseOrderDetailKey(r.purchase_order_id) }); await qc.invalidateQueries({ queryKey: purchaseOrderLinesKey(r.purchase_order_id) }); toast.success(`Created ${r.po_number} — open th`
  - `src/pages/purchase/PurchaseNewPoPage.tsx:115` — `await qc.invalidateQueries({ queryKey: purchaseOrderLinesKey(r.purchase_order_id) }); toast.success(`Created ${r.po_number} — open the PO and tap Start receiving (PO) to dock it`); navigate(`/purchase/po/${r.purchase_ord`
  - `src/pages/purchase/PurchasePoDetailPage.tsx:32` — `queryKey: purchaseOrderDetailKey(poId), queryFn: () => fetchPurchaseOrder(poId), enabled: Number.isFinite(poId) && poId > 0, });  const linesQuery = useQuery({`
  - `src/pages/purchase/PurchasePoDetailPage.tsx:38` — `queryKey: purchaseOrderLinesKey(poId), queryFn: () => fetchPurchaseOrderLines(poId), enabled: Number.isFinite(poId) && poId > 0, });  const invoiceQuery = useQuery({`
  - `src/pages/purchase/PurchasePoDetailPage.tsx:44` — `queryKey: ['purchase', 'po', poId, 'latest_invoice'], queryFn: () => fetchLatestSupplierInvoiceForPo(poId), enabled: Number.isFinite(poId) && poId > 0, });  const busyCodes = useMemo(`
  - `src/pages/purchase/PurchasePoDetailPage.tsx:60` — `await qc.invalidateQueries({ queryKey: RECEIVING_JOBS_QUERY_KEY }); toast.success(`Receiving ${r.job_public_id}`); navigate(`/admin/receiving/${r.receiving_job_id}`); }, onError: (e: Error) => toast.error(e.message \|\| 'C`
  - `src/pages/purchase/PurchasePoDetailPage.tsx:74` — `await qc.invalidateQueries({ queryKey: RECEIVING_JOBS_QUERY_KEY }); toast.success(`Receiving ${r.job_public_id}`); navigate(`/admin/receiving/${r.receiving_job_id}`); }, onError: (e: Error) => toast.error(e.message \|\| 'C`
  - `src/pages/purchase/PurchasePoDetailPage.tsx:84` — `await qc.invalidateQueries({ queryKey: purchaseOrderDetailKey(poId) }); await qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY }); toast.success('Marked sent'); }, onError: () => toast.error('Could not update')`
  - `src/pages/purchase/PurchasePoDetailPage.tsx:85` — `await qc.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY }); toast.success('Marked sent'); }, onError: () => toast.error('Could not update'), });`
  - `src/pages/purchase/PurchasePoDetailPage.tsx:94` — `await qc.invalidateQueries({ queryKey: purchaseOrderDetailKey(poId) }); toast.success('Saved'); }, onError: () => toast.error('Could not save'), });`
  - `src/pages/sales/CartPage.tsx:219` — `void queryClient.invalidateQueries({ queryKey: ['customers'] }); onChange(customer); closeSheet();  const reusedExisting = customers.some((entry) => entry.id === customer.id); if (reusedExisting) {`
  - `src/pages/sales/CartPage.tsx:1262` — `queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQueries({ queryKey: ['pending-items'] }); queryClient.invalidateQueries({ queryKey: ['open-po-demand-lines'] }); void invalidateLocationwiseS`
  - `src/pages/sales/CartPage.tsx:1263` — `queryClient.invalidateQueries({ queryKey: ['pending-items'] }); queryClient.invalidateQueries({ queryKey: ['open-po-demand-lines'] }); void invalidateLocationwiseStockQueries(queryClient); queryClient.invalidateQueries({`
  - `src/pages/sales/CartPage.tsx:1264` — `queryClient.invalidateQueries({ queryKey: ['open-po-demand-lines'] }); void invalidateLocationwiseStockQueries(queryClient); queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }); queryClient.invalidateQueries({ q`
  - `src/pages/sales/CartPage.tsx:1266` — `queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }); queryClient.invalidateQueries({ queryKey: ['customer_quick_reorder'] }); queryClient.invalidateQueries({ queryKey: ['salesperson_top_customers'] }); queryClie`
  - `src/pages/sales/CartPage.tsx:1267` — `queryClient.invalidateQueries({ queryKey: ['customer_quick_reorder'] }); queryClient.invalidateQueries({ queryKey: ['salesperson_top_customers'] }); queryClient.invalidateQueries({ queryKey: ['trending_items'] }); // Pus`
  - `src/pages/sales/CartPage.tsx:1268` — `queryClient.invalidateQueries({ queryKey: ['salesperson_top_customers'] }); queryClient.invalidateQueries({ queryKey: ['trending_items'] }); // Push the same refreshes to every other tab on this device — instant // cross`
  - `src/pages/sales/CartPage.tsx:1269` — `queryClient.invalidateQueries({ queryKey: ['trending_items'] }); // Push the same refreshes to every other tab on this device — instant // cross-tab updates even when wss:// is blocked. broadcastItemsChanged(); broadcast`
  - `src/pages/sales/MyOrdersPage.tsx:489` — `queryClient.invalidateQueries({ queryKey: ['pending-items'] }); queryClient.invalidateQueries({ queryKey: ['sales-pending-recovery'] }); queryClient.invalidateQueries({ queryKey: ['order'] });  if (vars.action === 'send_`
  - `src/pages/sales/MyOrdersPage.tsx:490` — `queryClient.invalidateQueries({ queryKey: ['sales-pending-recovery'] }); queryClient.invalidateQueries({ queryKey: ['order'] });  if (vars.action === 'send_to_billing') { toast.success('Sent back to billing for review');`
  - `src/pages/sales/MyOrdersPage.tsx:491` — `queryClient.invalidateQueries({ queryKey: ['order'] });  if (vars.action === 'send_to_billing') { toast.success('Sent back to billing for review'); return; }`
  - `src/pages/sales/MyOrdersPage.tsx:524` — `void queryClient.invalidateQueries({ queryKey: ['order', orderId] }); void queryClient.invalidateQueries({ queryKey: ['pending-items'] }); void queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); toast.suc`
  - `src/pages/sales/MyOrdersPage.tsx:525` — `void queryClient.invalidateQueries({ queryKey: ['pending-items'] }); void queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); toast.success('Line removed'); }, onError: (e: unknown) => { toast.error(e inst`
  - `src/pages/sales/MyOrdersPage.tsx:526` — `void queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); toast.success('Line removed'); }, onError: (e: unknown) => { toast.error(e instanceof Error ? e.message : 'Could not remove line'); },`
  - `src/pages/sales/MyOrdersPage.tsx:631` — `await queryClient.invalidateQueries({ queryKey: ['order', orderId] }); await queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); toast.success('Finished editing'); }, [releaseSalesEdit, queryClient, orderI`
  - `src/pages/sales/MyOrdersPage.tsx:632` — `await queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); toast.success('Finished editing'); }, [releaseSalesEdit, queryClient, orderId, toast]);  const canEditLines = useMemo(() => { if (!order \|\| userId`
  - `src/pages/sales/MyOrdersPage.tsx:978` — `void queryClient.invalidateQueries({ queryKey: ['order', order.id] }); }} /> </div> ) : null} </BottomSheet>`
  - `src/pages/sales/NewOrderPage.tsx:314` — `queryKey: ['salesperson_top_customers', userName], enabled: !!userName, staleTime: 60 * 1000, queryFn: async () => { if (!userName) return []; const { data, error } = await supabase.rpc('get_salesperson_top_customers_liv`
  - `src/pages/sales/NewOrderPage.tsx:329` — `queryKey: ['trending_items'], staleTime: 60 * 1000, queryFn: async () => { const { data, error } = await supabase.rpc('get_trending_items_live', { p_limit: 5 }); if (error) throw error; return (data ?? []) as TrendingRow`
  - `src/pages/sales/NewOrderPage.tsx:361` — `queryKey: ['customer_quick_reorder', activeCustomer?.id], enabled: !!activeCustomer?.id, staleTime: 60 * 1000, queryFn: async () => { const customerId = activeCustomer?.id; if (customerId == null) return [];`
  - `src/pages/sales/NewOrderPage.tsx:557` — `void queryClient.invalidateQueries({ queryKey: ['customers'] }); void queryClient.invalidateQueries({ queryKey: ['salesperson_top_customers', userName] }); selectCustomer(customer); closeCustomerSheet();  const reusedExi`
  - `src/pages/sales/NewOrderPage.tsx:558` — `void queryClient.invalidateQueries({ queryKey: ['salesperson_top_customers', userName] }); selectCustomer(customer); closeCustomerSheet();  const reusedExisting = customers.some((entry) => entry.id === customer.id); if (`
  - `src/pages/sales/PendingRecoveryPage.tsx:611` — `queryClient.invalidateQueries({ queryKey: ['sales-pending-recovery'] }); toast.success('Opened customer update in WhatsApp'); }, onError: () => { toast.error('Failed to mark the update as sent'); },`
  - `src/pages/sales/PendingRecoveryPage.tsx:692` — `queryClient.invalidateQueries({ queryKey: ['sales-pending-recovery'] }); queryClient.invalidateQueries({ queryKey: ['pending-items'] }); toast.success('Customer response saved'); }, onError: () => { toast.error('Failed t`
  - `src/pages/sales/PendingRecoveryPage.tsx:693` — `queryClient.invalidateQueries({ queryKey: ['pending-items'] }); toast.success('Customer response saved'); }, onError: () => { toast.error('Failed to save customer response'); },`
  - `src/pages/sales/PendingRecoveryPage.tsx:717` — `queryClient.invalidateQueries({ queryKey: ['sales-pending-recovery'] }); queryClient.invalidateQueries({ queryKey: ['pending-items'] }); queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQuer`
  - `src/pages/sales/PendingRecoveryPage.tsx:718` — `queryClient.invalidateQueries({ queryKey: ['pending-items'] }); queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); void invalidateLocationwiseStock`
  - `src/pages/sales/PendingRecoveryPage.tsx:719` — `queryClient.invalidateQueries({ queryKey: ['orders'] }); queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); void invalidateLocationwiseStockQueries(queryClient); setActivePartyKey(null); toast.success( re`
  - `src/pages/sales/PendingRecoveryPage.tsx:720` — `queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); void invalidateLocationwiseStockQueries(queryClient); setActivePartyKey(null); toast.success( result?.order_number ? `Recovery order ${result.order_numbe`
  - `src/pages/sales/SalesEditAddLineSheet.tsx:159` — `void queryClient.invalidateQueries({ queryKey: ['order', orderId] }); void queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); void queryClient.invalidateQueries({ queryKey: ['billing-stock-freshness'] });`
  - `src/pages/sales/SalesEditAddLineSheet.tsx:160` — `void queryClient.invalidateQueries({ queryKey: ['claimable-orders'] }); void queryClient.invalidateQueries({ queryKey: ['billing-stock-freshness'] }); void invalidateLocationwiseStockQueries(queryClient); void queryClien`
  - `src/pages/sales/SalesEditAddLineSheet.tsx:161` — `void queryClient.invalidateQueries({ queryKey: ['billing-stock-freshness'] }); void invalidateLocationwiseStockQueries(queryClient); void queryClient.invalidateQueries({ queryKey: ['pending-items'] }); onAdded(orderItemI`
  - `src/pages/sales/SalesEditAddLineSheet.tsx:163` — `void queryClient.invalidateQueries({ queryKey: ['pending-items'] }); onAdded(orderItemId); onClose(); }, onError: (err: unknown) => { setRpcError(formatSupabaseUserMessage(err));`
  - `src/stores/itemScanIndex.ts:136` — `queryKey: ITEMS_QUERY_KEY, queryFn: fetchAllItems, staleTime: Number.POSITIVE_INFINITY, }), fetchBarcodeMappings(), ])`

- Direct Supabase calls inside route/component files:
  - `src/components/picking/SwipeDeck.tsx` lines `375`
  - `src/components/shared/Skeleton.tsx` lines `20`, `44`, `65`
  - `src/pages/admin/BinOnboardingPage.tsx` lines `714`
  - `src/pages/admin/LabelStudioPage.tsx` lines `697`, `792`, `964`
  - `src/pages/admin/PackCatalogPage.tsx` lines `394`
  - `src/pages/admin/StockAuditLabelPrintPage.tsx` lines `58`
  - `src/pages/admin/UomOnboardingPage.tsx` lines `208`
  - `src/pages/admin/receiving/PutawayScanWizard.tsx` lines `330`
  - `src/pages/billing/CompactQueuePage.tsx` lines `722`, `767`, `773`
  - `src/pages/billing/DashboardPage.tsx` lines `249`
  - `src/pages/billing/HistoryPage.tsx` lines `164`
  - `src/pages/billing/LiveQueue/AddLineSheet.tsx` lines `127`
  - `src/pages/billing/LiveQueuePage.tsx` lines `249`, `449`, `464`, `476`, `515`, `554`, `569`, `602`, `613`, `637`, `723`, `736`
  - `src/pages/billing/RejectedPage.tsx` lines `149`
  - `src/pages/billing/ReviewPage.tsx` lines `383`, `409`, `413`, `446`, `472`, `484`, `491`, `519`, `580`, `600`, `643`, `666`
  - `src/pages/picking/PickPage.tsx` lines `431`, `746`, `755`, `853`, `876`, `924`
  - `src/pages/picking/QueuePage.tsx` lines `96`
  - `src/pages/sales/CartPage.tsx` lines `201`, `1183`
  - `src/pages/sales/MyOrdersPage.tsx` lines `479`, `511`
  - `src/pages/sales/NewOrderPage.tsx` lines `319`, `332`, `368`, `537`
  - `src/pages/sales/PendingRecoveryPage.tsx` lines `604`, `638`, `651`, `664`, `674`, `708`
  - `src/pages/sales/SalesEditAddLineSheet.tsx` lines `126`

- Realtime/subscription mechanisms:
  - `src/hooks/useAutoPickAssignment.ts:100` — `const unsubOrders = subscribeToTable({`
  - `src/hooks/useAutoPickAssignment.ts:107` — `const unsubClaims = subscribeToTable({`
  - `src/hooks/useClaimableOrders.ts:496` — `.channel(`billing-queue-events:${statusKey}:${todayOnly ?? false}`)`
  - `src/hooks/useClaimableOrders.ts:498` — `'postgres_changes',`
  - `src/hooks/useClaimableOrders.ts:553` — `const unsubOrders = subscribeToTable({`
  - `src/hooks/useClaimableOrders.ts:578` — `const unsubOrders = subscribeToTable({`
  - `src/hooks/useClaimableOrders.ts:588` — `? subscribeToTable({`
  - `src/hooks/useOrderDetail.ts:153` — `const unsubOrder = subscribeToTable({`
  - `src/hooks/useOrderDetail.ts:162` — `const unsubItems = subscribeToTable({`
  - `src/hooks/useOrders.ts:170` — `const unsub = subscribeToTable({`
  - `src/hooks/useUserNotifications.ts:63` — `const unsub = subscribeToTable({`
  - `src/lib/realtime.ts:8` — `* Resilient `postgres_changes` subscription helper.`
  - `src/lib/realtime.ts:136` — `ch = supabase.channel(opts.channelName);`
  - `src/lib/realtime.ts:139` — `'postgres_changes',`
  - `src/lib/realtimePolicy.ts:2` — `* Whether to use Supabase Realtime (`postgres_changes` over WebSocket).`

- `fetch()` / axios calls:
  - `src/lib/notificationDiagnostics.ts:31` — `const res = await fetch(endpoint, {`
  - `src/lib/ocr/gemini-extract.ts:69` — `const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {`
  - `src/lib/purchase/invoiceExtract.ts:153` — `const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {`
  - `src/pages/admin/ParetoLabelPrintPage.tsx:104` — `const res = await fetch(BUNDLED_PLAN_URL);`
  - `supabase/functions/verify-item/index.ts:23` — `const res = await fetch(`

### 2C. Global State

| State | Storage mechanism | Consumers / evidence |
|---|---|---|
| `AuthContext` | React context, localStorage, sessionStorage | `src/context/AuthContext.tsx:2`, `src/context/AuthContext.tsx:27`, `src/context/AuthContext.tsx:40`, `src/context/AuthContext.tsx:49`, `src/context/AuthContext.tsx:58`; imported by `src/App.tsx`, `src/components/dev/DevRoleSwitcher.tsx`, `src/components/notifications/NotificationDiagnosticsPanel.tsx`, `src/context/OrderAuthorContext.tsx`, `src/hooks/useAutoPickAssignment.ts`, `src/hooks/useClaimableOrders.ts`, `src/hooks/useWorkClaim.ts`, `src/main.tsx` |
| `CameraContext` | React context | `src/context/CameraContext.tsx:3`, `src/context/CameraContext.tsx:107`; imported by `src/hooks/useQRScanner.ts`, `src/main.tsx`, `src/pages/picking/PickingLayout.tsx` |
| `CartContext` | React context | `src/context/CartContext.tsx:2`, `src/context/CartContext.tsx:45`; imported by `src/pages/billing/BillingNewOrderLayout.tsx`, `src/pages/sales/CartPage.tsx`, `src/pages/sales/NewOrderPage.tsx`, `src/pages/sales/SalesLayout.tsx` |
| `OrderAuthorContext` | React context | `src/context/OrderAuthorContext.tsx:1`, `src/context/OrderAuthorContext.tsx:19`; imported by `src/context/CartContext.tsx`, `src/pages/billing/BillingNewOrderLayout.tsx`, `src/pages/sales/CartPage.tsx`, `src/pages/sales/NewOrderPage.tsx` |
| `OrderRoutesContext` | React context | `src/context/OrderRoutesContext.tsx:1`, `src/context/OrderRoutesContext.tsx:23`; imported by `src/pages/billing/BillingNewOrderLayout.tsx`, `src/pages/sales/CartPage.tsx`, `src/pages/sales/NewOrderPage.tsx` |
| `ToastContext` | React context | `src/context/ToastContext.tsx:2`, `src/context/ToastContext.tsx:31`; imported by `src/components/PwaUpdatePrompt.tsx`, `src/components/admin/StagingPromotePanel.tsx`, `src/components/receiving/ReceivingGatePanel.tsx`, `src/components/receiving/ReceivingGrnLineCard.tsx`, `src/components/receiving/ReceivingSortPanel.tsx`, `src/components/shared/Toast.tsx`, `src/main.tsx`, `src/pages/admin/BarcodeMappingPage.tsx` |
| `cartDraftStorage` | localStorage | `src/lib/cartDraftStorage.ts:48`, `src/lib/cartDraftStorage.ts:57`, `src/lib/cartDraftStorage.ts:66`; imported by `src/context/AuthContext.tsx`, `src/context/CartContext.tsx` |
| `idb` | IndexedDB | `src/lib/idb.ts:17`, `src/lib/idb.ts:22`; imported by `src/hooks/useItems.ts` |
| `precutSheetLayout` | localStorage | `src/lib/packCatalog/precutSheetLayout.ts:72`, `src/lib/packCatalog/precutSheetLayout.ts:85`; imported by `src/components/packCatalog/PrecutSheetPreview.tsx`, `src/lib/packCatalog/printPackLabels.ts`, `src/pages/admin/PackCatalogPage.tsx`, `src/pages/admin/ParetoLabelPrintPage.tsx`, `src/pages/admin/StockAuditLabelPrintPage.tsx` |
| `push` | localStorage | `src/lib/push.ts:39`, `src/lib/push.ts:42`; imported by `src/hooks/useRolePushNotifications.ts` |
| `acquireCamera` | sessionStorage | `src/lib/scanner/acquireCamera.ts:11`, `src/lib/scanner/acquireCamera.ts:28`, `src/lib/scanner/acquireCamera.ts:35`; imported by `src/context/CameraContext.tsx`, `src/hooks/useQRScanner.ts` |
| `feedback` | localStorage | `src/lib/scanner/feedback.ts:23`, `src/lib/scanner/feedback.ts:35`; imported by `src/components/shared/LiveQrScanner.tsx` |
| `PickPage` | sessionStorage | `src/pages/picking/PickPage.tsx:117`, `src/pages/picking/PickPage.tsx:130`, `src/pages/picking/PickPage.tsx:138`, `src/pages/picking/PickPage.tsx:144`, `src/pages/picking/PickPage.tsx:146`; imported by `src/App.tsx` |
| `SalesChromeContext` | React context | `src/pages/sales/SalesChromeContext.tsx:1`, `src/pages/sales/SalesChromeContext.tsx:11`; imported by `src/pages/billing/BillingNewOrderLayout.tsx`, `src/pages/sales/NewOrderPage.tsx`, `src/pages/sales/SalesLayout.tsx` |
| `itemScanIndex` | Zustand | `src/stores/itemScanIndex.ts:89`; imported by `src/components/shared/LiveQrScanner.tsx`, `src/context/CameraContext.tsx`, `src/lib/scanner/liveQrScannerTypes.ts`, `src/lib/scanner/resolvePickedScan.ts`, `src/pages/admin/BarcodeMappingPage.tsx`, `src/pages/admin/BinOnboardingPage.tsx`, `src/pages/admin/LabelStudioPage.tsx`, `src/pages/admin/PickScanLabPage.tsx` |

## SECTION 3 — FEATURE INVENTORY

| Feature | Entry point | Supabase tables it touches | Approximate files involved | Assessment |
|---|---|---|---|---|
| Custom auth + role selection | `src/pages/LoginPage.tsx / src/pages/RoleSelectPage.tsx` | app_config, users | Login, role picker, AuthContext, DevRoleSwitcher | CORE |
| Sales dashboard | `src/pages/sales/SalesHome.tsx` | sales_targets, salesperson_product_group_sales, salesperson_fy_sales, orders, pending_items | SalesHome + useSalesDashboard/useSalesPendingRecovery | CORE |
| Sales new order + cart submission | `src/pages/sales/NewOrderPage.tsx / src/pages/sales/CartPage.tsx` | customers, items, locationwise_stock, orders, order_items, pending_items, stock_reservations | Sales layout, CartContext, item/customer hooks, cart supply, order RPCs | CORE |
| Sales my orders + pending recovery | `src/pages/sales/MyOrdersPage.tsx / src/pages/sales/PendingRecoveryPage.tsx` | orders, order_items, pending_items, customers, items, users | Order detail/edit flows and recovery hooks | CORE |
| Billing dashboard + live queue | `src/pages/billing/DashboardPage.tsx / src/pages/billing/LiveQueuePage.tsx` | orders, order_items, pending_items, work_claims, billing_customer_updates, stock_reservations | Billing layout, live queue subviews, billing flow hooks | CORE |
| Billing review/approve/reject | `src/pages/billing/ReviewPage.tsx` | orders, order_items, pending_items, billing_customer_updates, work_claims | Review page, billing completion libs, stale pick completion | CORE |
| Picking queue and active pick | `src/pages/picking/QueuePage.tsx / src/pages/picking/PickPage.tsx` | orders, order_items, pending_items, work_claims, item_pack_definitions, bin_inventory_layers | Picking queue hooks, scanner, pick card components | CORE |
| Notifications and push alerts | `src/components/notifications/NotificationBell.tsx` | user_notifications, push_subscriptions, notification_events, users, orders | Notification hooks, service worker, push libraries, edge function | CORE |
| Admin data upload/import | `src/pages/admin/UploadPage.tsx` | items, customers, transports, sales_targets, item_pack_definitions, purchase_orders | Upload page and import parsers | SECONDARY |
| Barcode/UoM/bin onboarding | `src/pages/admin/BinOnboardingPage.tsx / src/pages/admin/BarcodeMappingPage.tsx` | items, item_barcodes, item_pack_definitions, bin_inventory, bin_inventory_layers, item_qr_tier_overrides | Admin onboarding screens and barcode mapping lib | SECONDARY |
| Pack catalog + label studio + label printing | `src/pages/admin/PackCatalogPage.tsx / src/pages/admin/LabelStudioPage.tsx` | items, item_pack_definitions | Pack catalog libs, label plan/print modules | SECONDARY |
| WMS cycle count | `src/pages/admin/CycleCountPage.tsx` | bin_inventory, bin_inventory_layers, item_pack_definitions, items | Cycle count page and WMS libs | SECONDARY |
| Purchase PO + invoice OCR | `src/pages/purchase/PurchaseHomePage.tsx` | purchase_orders, purchase_order_lines, purchase_invoices, purchase_invoice_lines, receiving_jobs | Purchase pages, invoice extraction, purchase API | SECONDARY |
| Receiving dock/sort/putaway | `src/pages/admin/receiving/ReceivingJobsPage.tsx` | receiving_jobs, receiving_job_lines, license_plates, receiving_scan_events, bin_inventory_layers | Receiving pages/components/API | SECONDARY |
| Supply-demand cockpit | `src/pages/admin/SupplyDemandPage.tsx` | order_items, pending_items, orders, items | Open PO demand hook and supply detail screens | SECONDARY |
| OCR order lab and scan labs | `src/pages/admin/OcrOrderLabPage.tsx / src/pages/admin/PickScanLabPage.tsx` | items, item_pack_definitions, item_barcodes | Lab pages and OCR/scanner libs | ORPHANED |

## SECTION 4 — PROBLEM PATTERNS

### 4A. Duplicate Logic

- Customer creation/search UI and new-party form logic appears in both sales order and cart flows: `src/pages/sales/NewOrderPage.tsx:521`, `src/pages/sales/CartPage.tsx:183`, with repeated party fields around `src/pages/sales/NewOrderPage.tsx:830` and `src/pages/sales/CartPage.tsx:448`.
- Add-line sheet logic is duplicated between billing and sales edit: `src/pages/billing/LiveQueue/AddLineSheet.tsx:119` and `src/pages/sales/SalesEditAddLineSheet.tsx:118`, including shared live-stock location labels at `src/pages/billing/LiveQueue/AddLineSheet.tsx:182` and `src/pages/sales/SalesEditAddLineSheet.tsx:182`.
- Billing approval/review flows repeat across full review, compact queue, and live queue: `src/pages/billing/ReviewPage.tsx:342`, `src/pages/billing/CompactQueuePage.tsx:736`, `src/pages/billing/LiveQueuePage.tsx:410`.
- Branch/location labeling is repeated outside a single UI adapter: `src/pages/admin/SupplyDemandPage.tsx:1271`, `src/pages/admin/SupplyDemandSkuDetailPage.tsx:154`, `src/pages/sales/SalesEditAddLineSheet.tsx:182`, `src/pages/billing/LiveQueue/AddLineSheet.tsx:182`.
- Scanner lookup/build-index logic spans `src/stores/itemScanIndex.ts:56`, `src/lib/scanner/qrPayload.ts`, `src/lib/scanner/qrMatch.ts`, and `src/lib/scanner/resolvePickedScan.ts`, with multiple candidate-normalization paths.

### 4B. Direct DB Calls in Components

- `src/components/picking/SwipeDeck.tsx` — `src/components/picking/SwipeDeck.tsx:375` {Array.from({ length: itemCount }).map((_, index) => {
- `src/components/shared/Skeleton.tsx` — `src/components/shared/Skeleton.tsx:20` {Array.from({ length: lines }).map((_, i) => (; `src/components/shared/Skeleton.tsx:44` {Array.from({ length: lines }).map((_, i) => (; `src/components/shared/Skeleton.tsx:65` {Array.from({ length: count }).map((_, i) => {
- `src/pages/admin/BinOnboardingPage.tsx` — `src/pages/admin/BinOnboardingPage.tsx:714` const { data, error } = await supabase.rpc('upsert_uom_definition', {
- `src/pages/admin/LabelStudioPage.tsx` — `src/pages/admin/LabelStudioPage.tsx:697` () => Array.from(new Set(labelableItems.map((item) => item.groupLabel))).sort((a, b) => a.localeComp; `src/pages/admin/LabelStudioPage.tsx:792` return Array.from(payloads);; `src/pages/admin/LabelStudioPage.tsx:964` return Array.from(next);
- `src/pages/admin/PackCatalogPage.tsx` — `src/pages/admin/PackCatalogPage.tsx:394` const labels = Array.from({ length: Math.max(1, rackPrintCount) }, () => label);
- `src/pages/admin/StockAuditLabelPrintPage.tsx` — `src/pages/admin/StockAuditLabelPrintPage.tsx:58` return Array.from(set).sort((a, b) => a.localeCompare(b));
- `src/pages/admin/UomOnboardingPage.tsx` — `src/pages/admin/UomOnboardingPage.tsx:208` const { data, error } = await supabase.rpc('upsert_uom_definition', {
- `src/pages/admin/receiving/PutawayScanWizard.tsx` — `src/pages/admin/receiving/PutawayScanWizard.tsx:330` const cards = Array.from({ length: n })
- `src/pages/billing/CompactQueuePage.tsx` — `src/pages/billing/CompactQueuePage.tsx:722` .from('orders'); `src/pages/billing/CompactQueuePage.tsx:767` const { error: updateError } = await supabase.from('order_items').update(update).eq('id', item.id);; `src/pages/billing/CompactQueuePage.tsx:773` const { error: pendingError } = await supabase.from('pending_items').insert({
- `src/pages/billing/DashboardPage.tsx` — `src/pages/billing/DashboardPage.tsx:249` .from('work_claims')
- `src/pages/billing/HistoryPage.tsx` — `src/pages/billing/HistoryPage.tsx:164` const { data, error: rpcError } = await supabase.rpc('revive_billing_order', {
- `src/pages/billing/LiveQueue/AddLineSheet.tsx` — `src/pages/billing/LiveQueue/AddLineSheet.tsx:127` const { data, error } = await supabase.rpc('add_billing_line', {
- `src/pages/billing/LiveQueuePage.tsx` — `src/pages/billing/LiveQueuePage.tsx:249` const { error } = await supabase.from('order_items').update(patch).eq('id', orderItemId);; `src/pages/billing/LiveQueuePage.tsx:449` const { error: evErr } = await supabase.from('order_events').insert({; `src/pages/billing/LiveQueuePage.tsx:464` .from('pending_items'); `src/pages/billing/LiveQueuePage.tsx:476` const { error: delErr } = await supabase.from('order_items').delete().eq('id', line.id);
- `src/pages/billing/RejectedPage.tsx` — `src/pages/billing/RejectedPage.tsx:149` const { data, error: rpcError } = await supabase.rpc('revive_billing_order', {
- `src/pages/billing/ReviewPage.tsx` — `src/pages/billing/ReviewPage.tsx:383` .from('order_items'); `src/pages/billing/ReviewPage.tsx:409` await supabase.from('order_items').delete().eq('id', rid);; `src/pages/billing/ReviewPage.tsx:413` .from('pending_items'); `src/pages/billing/ReviewPage.tsx:446` .from('pending_items')
- `src/pages/picking/PickPage.tsx` — `src/pages/picking/PickPage.tsx:431` if (len <= 3) return new Set(Array.from({ length: len }, (_, i) => i));; `src/pages/picking/PickPage.tsx:746` .from('pending_items'); `src/pages/picking/PickPage.tsx:755` await supabase.from('pending_items').insert({; `src/pages/picking/PickPage.tsx:853` const { error } = await supabase.rpc('complete_picking', {
- `src/pages/picking/QueuePage.tsx` — `src/pages/picking/QueuePage.tsx:96` const { data, error } = await supabase.rpc('claim_order', {
- `src/pages/sales/CartPage.tsx` — `src/pages/sales/CartPage.tsx:201` .from('customers'); `src/pages/sales/CartPage.tsx:1183` const { data: rpcData, error: rpcError } = await supabase.rpc('submit_sales_order', {
- `src/pages/sales/MyOrdersPage.tsx` — `src/pages/sales/MyOrdersPage.tsx:479` const { error } = await supabase.rpc('process_pending_recovery_action', {; `src/pages/sales/MyOrdersPage.tsx:511` const { data, error } = await supabase.rpc('remove_sales_submitted_line', {
- `src/pages/sales/NewOrderPage.tsx` — `src/pages/sales/NewOrderPage.tsx:319` const { data, error } = await supabase.rpc('get_salesperson_top_customers_live', {; `src/pages/sales/NewOrderPage.tsx:332` const { data, error } = await supabase.rpc('get_trending_items_live', { p_limit: 5 });; `src/pages/sales/NewOrderPage.tsx:368` const { data, error } = await supabase.rpc('get_customer_quick_reorder_stats', {; `src/pages/sales/NewOrderPage.tsx:537` .from('customers')
- `src/pages/sales/PendingRecoveryPage.tsx` — `src/pages/sales/PendingRecoveryPage.tsx:604` .from('pending_items'); `src/pages/sales/PendingRecoveryPage.tsx:638` .from('pending_items'); `src/pages/sales/PendingRecoveryPage.tsx:651` .from('pending_items'); `src/pages/sales/PendingRecoveryPage.tsx:664` .from('pending_items')
- `src/pages/sales/SalesEditAddLineSheet.tsx` — `src/pages/sales/SalesEditAddLineSheet.tsx:126` const { data, error } = await supabase.rpc('add_sales_submitted_line', {

### 4C. Prop Drilling

- Receiving `userId`/`userName` is read in `src/pages/admin/receiving/ReceivingJobDetailPage.tsx:60` and passed into nested panels/cards at `src/pages/admin/receiving/ReceivingJobDetailPage.tsx:423`, `:447`, `:602`, `:647`; child components declare the same props in `src/components/receiving/ReceivingGatePanel.tsx:82`, `src/components/receiving/ReceivingSortPanel.tsx:88`, `src/components/receiving/ReceivingGrnTable.tsx:34`, `src/components/receiving/ReceivingGrnLineCard.tsx:32`.
- Billing live queue passes `userId`, `claimId`, stock location and item/order state through page-to-sheet/view components: `src/pages/billing/LiveQueuePage.tsx:892`, `:924`, `src/pages/billing/LiveQueue/AddLineSheet.tsx:34`, `:45`.
- New-order item cards pass branch stock values through several nested components: `src/pages/sales/NewOrderPage.tsx:1127`, `:1253`, `:1404`, `:1467`, `:1751`, `:1797`, `:1828`.

### 4D. Dead Code

Unimported/unclear files from static import graph:
- `src/assets/react.svg` — status DEAD
- `src/components/receiving/ReceivingGrnTable.tsx` — status UNCLEAR
- `src/hooks/useAutoPickAssignment.ts` — status UNCLEAR
- `src/hooks/useNotificationArrivalAlerts.ts` — status UNCLEAR
- `src/lib/ocr/pickVerifier.ts` — status UNCLEAR
- `src/lib/picking/pickQueueBuckets.ts` — status UNCLEAR
- `src/lib/scanner/qrMatch.ts` — status UNCLEAR
- `src/pages/admin/receiving/ReceivingSkuCard.tsx` — status UNCLEAR
- `src/pages/billing/LiveQueue/CommitView.tsx` — status UNCLEAR
- `src/pages/billing/LiveQueue/CommunicateView.tsx` — status UNCLEAR
- `src/pages/billing/LiveQueue/CompleteView.tsx` — status UNCLEAR
- `src/pages/billing/LiveQueue/OrientView.tsx` — status UNCLEAR
- `src/pages/billing/LiveQueue/ProcessView.tsx` — status UNCLEAR
- `src/pages/billing/LiveQueue/ResolveView.tsx` — status UNCLEAR
- `src/types/qrcode.d.ts` — status UNCLEAR
- `src/workers/qrScanner.worker.ts` — status UNCLEAR
Comment blocks over 10 lines:
- `src/components/receiving/ReceivingGatePanel.tsx:23-36`
- `src/hooks/useItems.ts:8-31`
- `src/index.css:371-390`
- `src/lib/haptics.ts:1-37`
- `src/lib/orderItemCount.ts:9-20`
- `src/lib/realtime.ts:7-25`
- `src/lib/realtimePolicy.ts:1-12`

### 4E. Inconsistent Loading/Error States

- Some hooks expose query errors (`src/hooks/useSalesPendingRecovery.ts:293`, `src/hooks/useBillingStockFreshness.ts:165`), while several route-level queries read only `data`/`isLoading` or mutate with toast-only error paths; examples: `src/pages/admin/BarcodeMappingPage.tsx:266`, `src/pages/admin/PackCatalogPage.tsx:232`, `src/pages/admin/LabelStudioPage.tsx:629`.
- `AuthContext` login returns `false` for DB/config errors without exposing the underlying error: `src/context/AuthContext.tsx:135`, `src/context/AuthContext.tsx:142`.
- Realtime helper swallows channel removal/setup errors to keep UI alive: `src/lib/realtime.ts:61`, `src/lib/realtime.ts:158`, `src/lib/realtime.ts:206`; this is consistent operationally but hides detail from component error state.

### 4F. Mixed Concerns

- `src/pages/sales/NewOrderPage.tsx` — 2591 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/picking/PickPage.tsx` — 2223 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/admin/LabelStudioPage.tsx` — 2043 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/sales/CartPage.tsx` — 1805 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/admin/BinOnboardingPage.tsx` — 1777 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/admin/SupplyDemandPage.tsx` — 1473 lines; fetch=False; business logic=True; responsibility=mixed/large.
- `src/pages/billing/ReviewPage.tsx` — 1462 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/billing/LiveQueue/OrderSheetView.tsx` — 1433 lines; fetch=False; business logic=True; responsibility=mixed/large.
- `src/pages/admin/CycleCountPage.tsx` — 1312 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/sales/PendingRecoveryPage.tsx` — 1295 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/admin/BarcodeMappingPage.tsx` — 1291 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/sales/MyOrdersPage.tsx` — 1081 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/admin/PackCatalogPage.tsx` — 1077 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/admin/PickScanLabPage.tsx` — 994 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/billing/CompactQueuePage.tsx` — 964 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/billing/LiveQueuePage.tsx` — 963 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/components/shared/LiveQrScanner.tsx` — 782 lines; fetch=False; business logic=True; responsibility=mixed/large.
- `src/pages/admin/receiving/ReceivingJobDetailPage.tsx` — 756 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/admin/receiving/PutawayScanWizard.tsx` — 667 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/components/receiving/ReceivingGrnLineCard.tsx` — 602 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/components/receiving/ReceivingGatePanel.tsx` — 580 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/picking/QueueSheet.tsx` — 568 lines; fetch=False; business logic=True; responsibility=mixed/large.
- `src/components/receiving/ReceivingSortPanel.tsx` — 558 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/admin/UomOnboardingPage.tsx` — 495 lines; fetch=True; business logic=True; responsibility=mixed/large.
- `src/pages/billing/LiveQueue/ProcessView.tsx` — 439 lines; fetch=False; business logic=True; responsibility=mixed/large.

### 4G. Inline/Duplicated Types

Inline `interface`/`type` declarations found: **509**. Duplicate type/interface names by static name:
- `AgeBand` — `src/pages/admin/SupplyDemandPage.tsx:93`, `src/pages/admin/SupplyDemandSkuDetailPage.tsx:26`
- `AppRole` — `src/components/notifications/NotificationBell.tsx:9`, `src/hooks/useRolePushNotifications.ts:15`
- `BarcodeDetectorCtor` — `src/context/CameraContext.tsx:31`, `src/hooks/useQRScanner.ts:27`
- `BarcodeDetectorStatic` — `src/context/CameraContext.tsx:32`, `src/hooks/useQRScanner.ts:28`
- `BillingCustomerUpdateLineSummary` — `src/lib/buildBillingCustomerUpdate.ts:14`, `src/types/index.ts:526`
- `BillingCustomerUpdateSummary` — `src/lib/buildBillingCustomerUpdate.ts:23`, `src/types/index.ts:535`
- `BillingFlowState` — `src/hooks/useBillingFlow.ts:5`, `src/hooks/useBillingFlowMachine.ts:4`
- `ClaimResult` — `src/hooks/useWorkClaim.ts:9`, `src/lib/billing/completeBilling.ts:5`
- `CustomerSheetMode` — `src/pages/sales/CartPage.tsx:112`, `src/pages/sales/NewOrderPage.tsx:231`
- `GeminiCandidate` — `src/lib/ocr/gemini-extract.ts:43`, `src/lib/purchase/invoiceExtract.ts:70`
- `GeminiGenerateContentResponse` — `src/lib/ocr/gemini-extract.ts:47`, `src/lib/purchase/invoiceExtract.ts:74`
- `GeminiTextPart` — `src/lib/ocr/gemini-extract.ts:35`, `src/lib/purchase/invoiceExtract.ts:66`
- `GroupFilter` — `src/pages/admin/LabelStudioPage.tsx:37`, `src/pages/admin/StockAuditLabelPrintPage.tsx:27`
- `ItemLookupRow` — `src/lib/barcodeMapping.ts:8`, `src/lib/import/packDefinitionsImporter.ts:6`, `src/lib/import/purchasePoImporter.ts:33`
- `MatchStrategy` — `src/lib/ocr/types.ts:42`, `src/lib/scanner/barcodeParser.ts:1`
- `OrderItemPriceRow` — `src/hooks/useOpenPoDemandLines.ts:41`, `src/lib/purchase/openPoDemand.ts:155`
- `ReceivingPrintPlate` — `src/lib/labels/packStripPrint.ts:6`, `src/lib/receiving/receivingPrintUtils.ts:18`
- `SheetMode` — `src/pages/RoleSelectPage.tsx:8`, `src/pages/sales/PendingRecoveryPage.tsx:34`

### 4H. Magic Strings

Magic role/status/table/location strings detected outside shared constants/types: **422** occurrences. Representative evidence:
- `src/App.tsx:77` — `if (role === 'admin' && !adminUnlocked) return <Navigate to="/admin-passcode" replace />;`
- `src/App.tsx:121` — `<Route path="orders" element={<MyOrdersPage />} />`
- `src/App.tsx:137` — `<Route path="pending" element={<PendingPage />} />`
- `src/App.tsx:138` — `<Route path="rejected" element={<RejectedPage />} />`
- `src/App.tsx:142` — `<Route index element={<Navigate to="items" replace />} />`
- `src/App.tsx:143` — `<Route path="items" element={<NewOrderPage />} />`
- `src/components/billing/FulfillmentPathSelector.tsx:28` — `const locationLabel = stockLocationLabel(stockLocationCode ?? 'main_store');`
- `src/components/billing/FulfillmentPathSelector.tsx:96` — `{!warehousePickAllowed && stockLocationCode === 'jabalpur' && (`
- `src/components/billing/FulfillmentPathSelector.tsx:101` — `{!warehousePickAllowed && stockLocationCode !== 'jabalpur' && (pickLineCount ?? 0) <= 0 && (`
- `src/components/dev/DevRoleSwitcher.tsx:33` — `if (target === 'sales') {`
- `src/components/dev/DevRoleSwitcher.tsx:34` — `selectRole('sales', 'Demo Sales');`
- `src/components/dev/DevRoleSwitcher.tsx:35` — `} else if (target === 'picking') {`
- `src/components/dev/DevRoleSwitcher.tsx:36` — `selectRole('picking', 'Demo Picker');`
- `src/components/dev/DevRoleSwitcher.tsx:37` — `} else if (target === 'billing') {`
- `src/components/dev/DevRoleSwitcher.tsx:38` — `selectRole('billing', 'Demo Billing');`
- `src/components/dev/DevRoleSwitcher.tsx:40` — `selectRole('admin', 'Demo Admin');`
- `src/components/dev/DevRoleSwitcher.tsx:56` — `{(['sales', 'picking', 'billing'] as RoleKey[]).map((key) => (`
- `src/components/notifications/NotificationBell.tsx:9` — `type AppRole = 'sales' \| 'billing' \| 'picking' \| 'admin';`
- `src/components/notifications/NotificationBell.tsx:12` — `if (pathname.startsWith('/billing')) return 'billing';`
- `src/components/notifications/NotificationBell.tsx:13` — `if (pathname.startsWith('/sales')) return 'sales';`
- `src/components/notifications/NotificationBell.tsx:14` — `if (pathname.startsWith('/picking')) return 'picking';`
- `src/components/notifications/NotificationBell.tsx:15` — `if (pathname.startsWith('/admin')) return 'admin';`
- `src/components/notifications/NotificationBell.tsx:30` — `if (role === 'sales') {`
- `src/components/notifications/NotificationBell.tsx:38` — `if (role === 'billing') {`
- `src/components/notifications/NotificationBell.tsx:46` — `if (role === 'picking') return n.type === 'order_ready_to_pick';`
- `src/components/picking/CardHero.tsx:4` — `export type CardPhase = 'awaiting_rack' \| 'verified' \| 'picked' \| 'flagged' \| 'overridden' \| 'celebrating';`
- `src/components/picking/CardHero.tsx:33` — `const isDone = phase === 'picked' \|\| phase === 'flagged' \|\| phase === 'overridden';`
- `src/components/picking/CardHero.tsx:43` — `{phase === 'picked' && (`
- `src/components/picking/PickCard.tsx:54` — `const isDone = uiState === 'picked' \|\| uiState === 'flagged' \|\| uiState === 'overridden';`
- `src/components/picking/PickCard.tsx:67` — `: uiState === 'picked' \|\| uiState === 'overridden'`
- `src/components/picking/PickCard.tsx:68` — `? 'picked'`
- `src/components/shared/SalespersonSelectorSheet.tsx:30` — `const { data: salespeople = [], isLoading } = useTeamUsers('sales');`
- `src/components/shared/StatusBadge.tsx:2` — `\| 'submitted'`
- `src/components/shared/StatusBadge.tsx:3` — `\| 'approved'`
- `src/components/shared/StatusBadge.tsx:4` — `\| 'picking'`
- `src/components/shared/StatusBadge.tsx:5` — `\| 'completed'`
- `src/components/shared/StatusBadge.tsx:6` — `\| 'rejected'`
- `src/components/shared/StatusBadge.tsx:81` — `status === 'rejected' && rejectionKind === 'account_hold'`
- `src/context/AuthContext.tsx:12` — `type Role = 'sales' \| 'billing' \| 'picking' \| 'admin' \| null;`
- `src/context/AuthContext.tsx:114` — `if (!userName \|\| !role \|\| role === 'admin' \|\| userId !== null) return;`
- `src/context/AuthContext.tsx:117` — `.from('users')`
- `src/context/AuthContext.tsx:175` — `.from('users')`
- `src/hooks/useAutoPickAssignment.ts:102` — `table: 'orders',`
- `src/hooks/useAutoPickAssignment.ts:109` — `table: 'work_claims',`
- `src/hooks/useBillingStockFreshness.ts:81` — `const loc = (stockLocationCode === 'jabalpur' ? 'jabalpur' : 'main_store') as StockLocationCode;`
- `src/hooks/useBillingStockFreshness.ts:162` — `const loc = (stockLocationCode === 'jabalpur' ? 'jabalpur' : 'main_store') as StockLocationCode;`
- `src/hooks/useClaimableOrders.ts:146` — `return stage === 'billing' && BILLING_QUEUE_EVENTS_ON;`
- `src/hooks/useClaimableOrders.ts:152` — `if (order.stock_location_code === 'jabalpur') return false;`
- `src/hooks/useClaimableOrders.ts:170` — `if (order.workflow_status === 'picking') {`
- `src/hooks/useClaimableOrders.ts:174` — `if (order.workflow_status === 'approved') return 'available';`
- `src/hooks/useClaimableOrders.ts:186` — `.from('orders')`
- `src/hooks/useClaimableOrders.ts:210` — `if (stage === 'picking') {`
- `src/hooks/useClaimableOrders.ts:224` — `.from('customers')`
- `src/hooks/useClaimableOrders.ts:235` — `const claimStages = stage === 'billing' ? ['billing', 'sales_edit'] : [stage];`
- `src/hooks/useClaimableOrders.ts:238` — `.from('work_claims')`
- `src/hooks/useClaimableOrders.ts:555` — `table: 'orders',`
- `src/hooks/useClaimableOrders.ts:580` — `table: 'orders',`
- `src/hooks/useClaimableOrders.ts:587` — `stage === 'picking'`
- `src/hooks/useClaimableOrders.ts:590` — `table: 'work_claims',`
- `src/hooks/useClaimableOrders.ts:614` — `if (stage === 'picking') {`
- `src/hooks/useClaimableOrders.ts:624` — `if (stage === 'picking') {`
- `src/hooks/useCustomers.ts:9` — `.from('customers')`
- `src/hooks/useCustomers.ts:20` — `.from('customers')`
- `src/hooks/useCustomers.ts:46` — `queryKey: ['customers'],`
- `src/hooks/useItems.ts:240` — `.from('items')`
- `src/hooks/useItems.ts:273` — `.from('items')`
- `src/hooks/useItems.ts:299` — `export const ITEMS_QUERY_KEY = ['items'] as const;`
- `src/hooks/useLocationwiseStock.ts:103` — `if (row.stock_location_code === 'jabalpur') {`
- `src/hooks/useLocationwiseStock.ts:108` — `if (row.stock_location_code === 'main_store') {`
- `src/hooks/useLocationwiseStock.ts:139` — `if (normalized === 'jbp' \|\| normalized === 'jbl' \|\| normalized === 'jabalpur') return 'Jabalpur';`
- `src/hooks/useLocationwiseStock.ts:145` — `return stockLocationCode === 'jabalpur' ? 'Jabalpur' : 'Main Store';`
- `src/hooks/useLocationwiseStock.ts:152` — `return stockLocationCode === 'jabalpur'`
- `src/hooks/useOpenPoDemandLines.ts:125` — `function toItemEmbed(row: ItemGroupRow): NonNullable<OpenPoDemandLine['items']> {`
- `src/hooks/useOpenPoDemandLines.ts:164` — `.from('order_items')`
- `src/hooks/useOpenPoDemandLines.ts:176` — `.from('order_items')`
- `src/hooks/useOpenPoDemandLines.ts:187` — `.from('orders')`
- `src/hooks/useOpenPoDemandLines.ts:199` — `.from('orders')`
- `src/hooks/useOpenPoDemandLines.ts:210` — `.from('order_items')`
- `src/hooks/useOpenPoDemandLines.ts:217` — `.from('order_items')`
- `src/hooks/useOpenPoDemandLines.ts:240` — `.from('pending_items')`
- `src/hooks/useOpenPoDemandLines.ts:242` — `.eq('status', 'pending')`
- `src/hooks/useOpenPoDemandLines.ts:249` — `.from('pending_items')`
- `src/hooks/useOpenPoDemandLines.ts:251` — `.eq('status', 'pending')`
- `src/hooks/useOpenPoDemandLines.ts:277` — `.from('items')`
- `src/hooks/useOrderDetail.ts:64` — `.from('orders')`
- `src/hooks/useOrderDetail.ts:72` — `.from('order_items')`
- `src/hooks/useOrderDetail.ts:110` — `.from('customers')`
- `src/hooks/useOrderDetail.ts:155` — `table: 'orders',`
- `src/hooks/useOrderDetail.ts:164` — `table: 'order_items',`
- `src/hooks/useOrders.ts:73` — `'orders',`
- `src/hooks/useOrders.ts:107` — `.from('orders')`
- `src/hooks/useOrders.ts:124` — `q = q.eq('workflow_status', 'submitted').lt('created_at', todayIso);`
- `src/hooks/useOrders.ts:172` — `table: 'orders',`
- `src/hooks/usePendingItems.ts:25` — `let q = supabase.from('pending_items').select('*').order('created_at', {`
- `src/hooks/usePickingClaim.ts:22` — `.from('work_claims')`
- `src/hooks/usePickingClaim.ts:27` — `.eq('stage', 'picking')`
- `src/hooks/useRolePushNotifications.ts:15` — `export type AppRole = 'sales' \| 'billing' \| 'picking' \| 'admin';`
- `src/hooks/useRolePushNotifications.ts:47` — `if (!subscription \|\| !role \|\| role === 'admin' \|\| !userId \|\| !userName) {`
- `src/hooks/useRolePushNotifications.ts:128` — `if (!role \|\| role === 'admin' \|\| !state.enabled) return;`
- `src/hooks/useRolePushNotifications.ts:171` — `if (!role \|\| role === 'admin' \|\| !userId \|\| !userName) {`
- `src/hooks/useRolePushNotifications.ts:257` — `} else if (role && role !== 'admin' && userId) {`
- `src/hooks/useSalesDashboard.ts:162` — `.from('orders')`
- `src/hooks/useSalesDashboard.ts:176` — `.from('orders')`
- `src/hooks/useSalesPendingRecovery.ts:288` — `return value === 'jabalpur' ? 'jabalpur' : 'main_store';`
- `src/hooks/useSalesPendingRecovery.ts:298` — `.from('pending_items')`
- `src/hooks/useSalesPendingRecovery.ts:300` — `.eq('status', 'pending')`
- `src/hooks/useSalesPendingRecovery.ts:336` — `.from('orders')`
- `src/hooks/useSalesPendingRecovery.ts:342` — `.from('customers')`
- `src/hooks/useSalesPendingRecovery.ts:349` — `.from('items')`
- `src/hooks/useSalesPendingRecovery.ts:356` — `.from('order_items')`
- `src/hooks/useSalesPendingRecovery.ts:370` — `if (userId == null) return 'main_store';`
- `src/hooks/useSalesPendingRecovery.ts:372` — `.from('users')`
- `src/hooks/useTeamUsers.ts:11` — `queryKey: ['users', role ?? 'all'],`
- `src/hooks/useTeamUsers.ts:14` — `.from('users')`
- `src/hooks/useUserStockLocation.ts:5` — `const DEFAULT_STOCK_LOCATION_CODE: StockLocationCode = 'main_store';`
- `src/hooks/useUserStockLocation.ts:15` — `return value === 'jabalpur' ? 'jabalpur' : DEFAULT_STOCK_LOCATION_CODE;`
- `src/hooks/useUserStockLocation.ts:32` — `.from('users')`
- `src/hooks/useUserStockLocation.ts:46` — `.from('users')`
- `src/lib/barcodeMapping.ts:181` — `.from('items')`
- `src/lib/barcodeMapping.ts:223` — `.from('items')`
- `src/lib/barcodeMapping.ts:340` — `.from('items')`
- `src/lib/billing/fulfillmentPath.ts:7` — `if (stockLocationCode === 'jabalpur') return 'direct_bill';`
- `src/lib/billing/fulfillmentPath.ts:16` — `if (stockLocationCode === 'jabalpur') return false;`
- `src/lib/billing/fulfillmentPath.ts:30` — `return stockLocationCode === 'jabalpur'`
- `src/lib/billing/fulfillmentPath.ts:34` — `return stockLocationCode === 'jabalpur'`
- `src/lib/billing/liveQueueDraft.ts:151` — `deleteIds.map((id) => supabase.from('order_items').delete().eq('id', id)),`
- `src/lib/billing/liveQueueDraft.ts:176` — `supabase.from('order_items').update(patch).eq('id', id),`
- `src/lib/billing/rejectionKind.ts:8` — `order.workflow_status === 'rejected' && order.rejection_kind === 'account_hold'`
- `src/lib/billing/rejectionKind.ts:21` — `if (order.workflow_status !== 'rejected') return false;`
- `src/lib/buildBillingCustomerUpdate.ts:20` — `classification: 'billed' \| 'partial' \| 'pending';`
- `src/lib/buildBillingCustomerUpdate.ts:48` — `return 'pending';`
- `src/lib/import/customerImporter.ts:63` — `const { data: existing } = await supabase.from('customers').select('name').returns<{name: string}[]>();`
- `src/lib/import/customerImporter.ts:103` — `const { error } = await supabase.from('customers').upsert(records, { onConflict: 'name' });`
- `src/lib/import/customerImporter.ts:127` — `file_type: 'customers',`
- `src/lib/import/customerImporter.ts:132` — `status: 'completed',`
- `src/lib/import/fileDetector.ts:8` — `\| 'customers'`
- `src/lib/import/fileDetector.ts:191` — `type: 'customers',`
- `src/lib/import/itemImporter.ts:149` — `.from('items')`
- `src/lib/import/itemImporter.ts:219` — `const { error } = await supabase.from('items').upsert(changedRecords, { onConflict: 'name' });`
- `src/lib/import/itemImporter.ts:249` — `status: 'completed',`
- `src/lib/import/packDefinitionsImporter.ts:70` — `.from('items')`
- `src/lib/import/packDefinitionsImporter.ts:293` — `status: 'completed',`
- `src/lib/import/purchasePoImporter.ts:212` — `.from('items')`
- `src/lib/import/salesHistoryImporter.ts:357` — `status: failedCount > 0 ? 'completed_with_errors' : 'completed',`
- `src/lib/import/salesTargetsImporter.ts:222` — `status: 'completed',`
- `src/lib/import/salesTargetsImporter.ts:271` — `status: 'completed',`
- `src/lib/import/stockImporter.ts:120` — `.from('items')`
- `src/lib/import/stockImporter.ts:173` — `const { error } = await supabase.from('items').upsert(changedRecords, { onConflict: 'name' });`
- `src/lib/import/stockImporter.ts:202` — `status: 'completed',`
- `src/lib/import/transportImporter.ts:138` — `status: 'completed',`
- `src/lib/notificationDiagnostics.ts:118` — `const isAdminNoPersona = opts.role === 'admin';`
- `src/lib/ocr/gemini-extract.ts:31` — `Return: { "customer_name": string \| null, "items": [{ "raw_text": string, "qty": number, "qty_unit": string, "is_cancelled": boolean }] }`;`
- `src/lib/ocr/matcher.ts:155` — `.from('items')`
- `src/lib/ocr/matcher.ts:167` — `.from('items')`
- `src/lib/ocr/matcher.ts:199` — `.from('customers')`
- `src/lib/ocr/matcher.ts:263` — `supabase.from('items').select(ITEM_SELECT).eq('is_active', true).in('alias', exactCodes),`
- `src/lib/ocr/matcher.ts:264` — `supabase.from('items').select(ITEM_SELECT).eq('is_active', true).in('alias1', exactCodes),`
- `src/lib/ocr/matcher.ts:326` — `.from('items')`
- `src/lib/ocr/pipeline.ts:74` — `.from('customers')`
- `src/lib/ocr/pipeline.ts:97` — `.from('customers')`
- ... +262 additional occurrences in the generated scan.

## SECTION 5 — AUTH & SESSION AUDIT

- Current user identification is custom app auth, not Supabase Auth session state. `src/context/AuthContext.tsx:135` checks `app_config.value` for key `access_code`; role/name/id are persisted under local/session storage keys at `src/context/AuthContext.tsx:29`.
- `userId` is resolved by querying `users` by selected role and full-name match at `src/context/AuthContext.tsx:172`; older sessions are backfilled in `src/context/AuthContext.tsx:112`.
- Session/user state is stored in `AuthContext` React state (`src/context/AuthContext.tsx:105`) plus `localStorage` for authenticated/role/name/id (`src/context/AuthContext.tsx:37`) and `sessionStorage` for admin unlock (`src/context/AuthContext.tsx:46`, `:152`).
- Branch is modeled primarily as `StockLocationCode = 'main_store' | 'jabalpur'` in `src/types/index.ts:253`; it is stored on orders/order items as `stock_location_code` (`src/types/index.ts:75`, `:127`, `:171`) and as user stock mapping through `useUserStockLocation` (`src/hooks/useUserStockLocation.ts:28`). No `indore` literal appears as a `StockLocationCode`; Indore appears as main store language.
- Frontend route guards do not enforce exact roles per route. `RequireRole` only checks that any role exists at `src/App.tsx:68`; admin passcode only applies when selected role is `admin` at `src/App.tsx:75`.
- RLS policies found in migrations:
  - `supabase/migrations/021_fix_notification_scoping.sql:40` — `ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;`
  - `supabase/migrations/021_fix_notification_scoping.sql:48` — `DROP POLICY IF EXISTS user_notifications_select_own ON public.user_notifications;`
  - `supabase/migrations/021_fix_notification_scoping.sql:49` — `DROP POLICY IF EXISTS user_notifications_update_own ON public.user_notifications;`
  - `supabase/migrations/021_fix_notification_scoping.sql:52` — `CREATE POLICY user_notifications_select_own`
  - `supabase/migrations/021_fix_notification_scoping.sql:58` — `CREATE POLICY user_notifications_update_own`
  - `supabase/migrations/021_fix_notification_scoping.sql:69` — `ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;`
  - `supabase/migrations/021_fix_notification_scoping.sql:71` — `DROP POLICY IF EXISTS push_subscriptions_select ON public.push_subscriptions;`
  - `supabase/migrations/021_fix_notification_scoping.sql:72` — `DROP POLICY IF EXISTS push_subscriptions_insert ON public.push_subscriptions;`
  - `supabase/migrations/021_fix_notification_scoping.sql:73` — `DROP POLICY IF EXISTS push_subscriptions_update ON public.push_subscriptions;`
  - `supabase/migrations/021_fix_notification_scoping.sql:76` — `CREATE POLICY push_subscriptions_select`
  - `supabase/migrations/021_fix_notification_scoping.sql:81` — `CREATE POLICY push_subscriptions_insert`
  - `supabase/migrations/021_fix_notification_scoping.sql:86` — `CREATE POLICY push_subscriptions_update`
  - `supabase/migrations/036_erp_items_delta_rpc.sql:40` — `ALTER TABLE public.inventory_sync_runs ENABLE ROW LEVEL SECURITY;`
  - `supabase/migrations/050_uom_hierarchy_mapper.sql:52` — `ALTER TABLE public.item_qr_tier_overrides ENABLE ROW LEVEL SECURITY;`
  - `supabase/migrations/050_uom_hierarchy_mapper.sql:54` — `DROP POLICY IF EXISTS item_qr_tier_overrides_authenticated_all ON public.item_qr_tier_overrides;`
  - `supabase/migrations/050_uom_hierarchy_mapper.sql:55` — `DROP POLICY IF EXISTS item_qr_tier_overrides_anon_all ON public.item_qr_tier_overrides;`
  - `supabase/migrations/050_uom_hierarchy_mapper.sql:57` — `CREATE POLICY item_qr_tier_overrides_authenticated_all`
  - `supabase/migrations/050_uom_hierarchy_mapper.sql:64` — `CREATE POLICY item_qr_tier_overrides_anon_all`
  - `supabase/migrations/057_receiving_jobs.sql:68` — `ALTER TABLE public.receiving_jobs ENABLE ROW LEVEL SECURITY;`
  - `supabase/migrations/057_receiving_jobs.sql:69` — `ALTER TABLE public.receiving_job_lines ENABLE ROW LEVEL SECURITY;`
  - `supabase/migrations/057_receiving_jobs.sql:71` — `DROP POLICY IF EXISTS receiving_jobs_authenticated_all ON public.receiving_jobs;`
  - `supabase/migrations/057_receiving_jobs.sql:72` — `CREATE POLICY receiving_jobs_authenticated_all`
  - `supabase/migrations/057_receiving_jobs.sql:74` — `DROP POLICY IF EXISTS receiving_jobs_anon_all ON public.receiving_jobs;`
  - `supabase/migrations/057_receiving_jobs.sql:75` — `CREATE POLICY receiving_jobs_anon_all`
  - `supabase/migrations/057_receiving_jobs.sql:78` — `DROP POLICY IF EXISTS receiving_job_lines_authenticated_all ON public.receiving_job_lines;`
  - `supabase/migrations/057_receiving_jobs.sql:79` — `CREATE POLICY receiving_job_lines_authenticated_all`
  - `supabase/migrations/057_receiving_jobs.sql:81` — `DROP POLICY IF EXISTS receiving_job_lines_anon_all ON public.receiving_job_lines;`
  - `supabase/migrations/057_receiving_jobs.sql:82` — `CREATE POLICY receiving_job_lines_anon_all`
  - `supabase/migrations/059_receiving_scan_events.sql:27` — `ALTER TABLE public.receiving_scan_events ENABLE ROW LEVEL SECURITY;`
  - `supabase/migrations/059_receiving_scan_events.sql:29` — `DROP POLICY IF EXISTS receiving_scan_events_authenticated_all ON public.receiving_scan_events;`
  - `supabase/migrations/059_receiving_scan_events.sql:30` — `CREATE POLICY receiving_scan_events_authenticated_all`
  - `supabase/migrations/059_receiving_scan_events.sql:32` — `DROP POLICY IF EXISTS receiving_scan_events_anon_all ON public.receiving_scan_events;`
  - `supabase/migrations/059_receiving_scan_events.sql:33` — `CREATE POLICY receiving_scan_events_anon_all`
  - `supabase/migrations/065_bin_inventory_layers.sql:50` — `ALTER TABLE public.bin_inventory_layers ENABLE ROW LEVEL SECURITY;`
  - `supabase/migrations/065_bin_inventory_layers.sql:51` — `DROP POLICY IF EXISTS bin_inventory_layers_authenticated_all ON public.bin_inventory_layers;`
  - `supabase/migrations/065_bin_inventory_layers.sql:52` — `CREATE POLICY bin_inventory_layers_authenticated_all`
  - `supabase/migrations/065_bin_inventory_layers.sql:54` — `DROP POLICY IF EXISTS bin_inventory_layers_anon_all ON public.bin_inventory_layers;`
  - `supabase/migrations/065_bin_inventory_layers.sql:55` — `CREATE POLICY bin_inventory_layers_anon_all`
  - `supabase/migrations/065_bin_inventory_layers.sql:77` — `ALTER TABLE public.bin_layer_pick_events ENABLE ROW LEVEL SECURITY;`
  - `supabase/migrations/065_bin_inventory_layers.sql:78` — `DROP POLICY IF EXISTS bin_layer_pick_events_authenticated_all ON public.bin_layer_pick_events;`
  - `supabase/migrations/065_bin_inventory_layers.sql:79` — `CREATE POLICY bin_layer_pick_events_authenticated_all`
  - `supabase/migrations/065_bin_inventory_layers.sql:81` — `DROP POLICY IF EXISTS bin_layer_pick_events_anon_all ON public.bin_layer_pick_events;`
  - `supabase/migrations/065_bin_inventory_layers.sql:82` — `CREATE POLICY bin_layer_pick_events_anon_all`
  - `supabase/migrations/066_purchase_orders.sql:109` — `ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;`
  - `supabase/migrations/066_purchase_orders.sql:110` — `ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;`
  - `supabase/migrations/066_purchase_orders.sql:111` — `ALTER TABLE public.supplier_invoices ENABLE ROW LEVEL SECURITY;`
  - `supabase/migrations/066_purchase_orders.sql:112` — `ALTER TABLE public.supplier_invoice_lines ENABLE ROW LEVEL SECURITY;`
  - `supabase/migrations/066_purchase_orders.sql:114` — `DROP POLICY IF EXISTS purchase_orders_authenticated_all ON public.purchase_orders;`
  - `supabase/migrations/066_purchase_orders.sql:115` — `CREATE POLICY purchase_orders_authenticated_all`
  - `supabase/migrations/066_purchase_orders.sql:117` — `DROP POLICY IF EXISTS purchase_orders_anon_all ON public.purchase_orders;`
  - `supabase/migrations/066_purchase_orders.sql:118` — `CREATE POLICY purchase_orders_anon_all`
  - `supabase/migrations/066_purchase_orders.sql:121` — `DROP POLICY IF EXISTS purchase_order_lines_authenticated_all ON public.purchase_order_lines;`
  - `supabase/migrations/066_purchase_orders.sql:122` — `CREATE POLICY purchase_order_lines_authenticated_all`
  - `supabase/migrations/066_purchase_orders.sql:124` — `DROP POLICY IF EXISTS purchase_order_lines_anon_all ON public.purchase_order_lines;`
  - `supabase/migrations/066_purchase_orders.sql:125` — `CREATE POLICY purchase_order_lines_anon_all`
  - `supabase/migrations/066_purchase_orders.sql:128` — `DROP POLICY IF EXISTS supplier_invoices_authenticated_all ON public.supplier_invoices;`
  - `supabase/migrations/066_purchase_orders.sql:129` — `CREATE POLICY supplier_invoices_authenticated_all`
  - `supabase/migrations/066_purchase_orders.sql:131` — `DROP POLICY IF EXISTS supplier_invoices_anon_all ON public.supplier_invoices;`
  - `supabase/migrations/066_purchase_orders.sql:132` — `CREATE POLICY supplier_invoices_anon_all`
  - `supabase/migrations/066_purchase_orders.sql:135` — `DROP POLICY IF EXISTS supplier_invoice_lines_authenticated_all ON public.supplier_invoice_lines;`
  - `supabase/migrations/066_purchase_orders.sql:136` — `CREATE POLICY supplier_invoice_lines_authenticated_all`
  - `supabase/migrations/066_purchase_orders.sql:138` — `DROP POLICY IF EXISTS supplier_invoice_lines_anon_all ON public.supplier_invoice_lines;`
  - `supabase/migrations/066_purchase_orders.sql:139` — `CREATE POLICY supplier_invoice_lines_anon_all`
- Frontend user role/branch checks:
  - `src/App.tsx` — `77`
  - `src/components/billing/FulfillmentPathSelector.tsx` — `28`, `96`, `101`
  - `src/components/dev/DevRoleSwitcher.tsx` — `34`, `36`, `38`, `40`, `62`
  - `src/components/notifications/NotificationBell.tsx` — `30`, `38`, `46`
  - `src/context/AuthContext.tsx` — `114`
  - `src/hooks/useBillingStockFreshness.ts` — `81`, `162`
  - `src/hooks/useClaimableOrders.ts` — `152`
  - `src/hooks/useLocationwiseStock.ts` — `7`, `9`, `11`, `30`, `32`, `34`
  - `src/hooks/useRolePushNotifications.ts` — `47`, `128`, `171`, `257`
  - `src/hooks/useSalesPendingRecovery.ts` — `288`, `370`
  - `src/hooks/useUserStockLocation.ts` — `5`, `15`
  - `src/lib/billing/fulfillmentPath.ts` — `7`, `16`, `30`, `34`
  - `src/lib/notificationDiagnostics.ts` — `118`
  - `src/lib/purchase/openPoDemand.ts` — `75`, `76`, `82`, `86`, `87`, `92`
  - `src/pages/RoleSelectPage.tsx` — `67`, `73`, `79`, `128`
  - `src/pages/admin/AdminPasscodePage.tsx` — `51`
  - `src/pages/admin/SupplyDemandPage.tsx` — `947`, `948`, `1354`
  - `src/pages/admin/SupplyDemandSkuDetailPage.tsx` — `161`
  - `src/pages/billing/LiveQueue/AddLineSheet.tsx` — `82`, `182`
  - `src/pages/billing/LiveQueuePage.tsx` — `596`
  - `src/pages/purchase/PurchasePoDetailPage.tsx` — `217`, `218`, `225`
  - `src/pages/purchase/PurchasePoPreviewTable.tsx` — `96`
  - `src/pages/sales/CartPage.tsx` — `975`
  - `src/pages/sales/NewOrderPage.tsx` — `1127`, `1253`, `1261`, `1269`, `1292`, `1324`
  - `src/pages/sales/SalesEditAddLineSheet.tsx` — `81`, `182`
  - `src/types/index.ts` — `253`

## SECTION 6 — ROUTING AUDIT

Route guards are centralized in `src/App.tsx`: `RequireAuth` redirects unauthenticated users to `/login` (`src/App.tsx:62`), `RequireRole` only requires any selected role and redirects to `/select-role` if missing (`src/App.tsx:68`), and `RequireAdminUnlock` only blocks when the selected role is `admin` and the admin passcode is not unlocked (`src/App.tsx:75`). The router does not check that `/sales` is only used by `sales`, `/billing` only by `billing`, etc.

| Path | Component rendered | Who can access it | Is it reachable from UI navigation? | Evidence |
|---|---|---|---|---|
| `/` | `RootRedirect` | Public redirect; sends unauthenticated users to `/login`, otherwise role home or `/select-role` | Root/catch-all | `src/App.tsx:98` |
| `/login` | `LoginPage` | Public; page redirects authenticated users to `/select-role` | Yes, auth redirect target | `src/App.tsx:99`, `src/pages/LoginPage.tsx:51` |
| `/select-role` | `RoleSelectPage` | `RequireAuth` | Yes, login and role-switch target | `src/App.tsx:101`, `src/components/dev/DevRoleSwitcher.tsx:42` |
| `/sales` | `SalesLayout` + `SalesHome` index | `RequireRole` any selected role | Yes, role home and bottom nav | `src/App.tsx:111`, `src/App.tsx:118`, `src/pages/sales/SalesLayout.tsx:22` |
| `/sales/new` | `NewOrderPage` | `RequireRole` via `/sales` parent | Yes, sales bottom nav | `src/App.tsx:119`, `src/pages/sales/SalesLayout.tsx:26` |
| `/sales/cart` | `CartPage` | `RequireRole` via `/sales` parent | Yes, new-order/cart flow | `src/App.tsx:120`, `src/pages/sales/NewOrderPage.tsx:1965` |
| `/sales/orders` | `MyOrdersPage` | `RequireRole` via `/sales` parent | Yes, sales bottom nav/home | `src/App.tsx:121`, `src/pages/sales/SalesLayout.tsx:33` |
| `/sales/pending-recovery` | `PendingRecoveryPage` | `RequireRole` via `/sales` parent | Yes, sales bottom nav/home | `src/App.tsx:122`, `src/pages/sales/SalesLayout.tsx:40` |
| `/billing` | `BillingLayout` + `DashboardPage` index | `RequireRole` any selected role | Yes, billing bottom/sidebar nav | `src/App.tsx:127`, `src/App.tsx:134`, `src/pages/billing/BillingLayout.tsx:28` |
| `/billing/queue` | `LiveQueuePage` | `RequireRole` via `/billing` parent | Yes, billing nav and dashboard links | `src/App.tsx:135`, `src/pages/billing/BillingLayout.tsx:32` |
| `/billing/needs-review` | `NeedsReviewPage` | `RequireRole` via `/billing` parent | Yes, billing nav/dashboard | `src/App.tsx:136`, `src/pages/billing/BillingLayout.tsx:45` |
| `/billing/pending` | `PendingPage` | `RequireRole` via `/billing` parent | Yes, billing nav | `src/App.tsx:137`, `src/pages/billing/BillingLayout.tsx:51` |
| `/billing/rejected` | `RejectedPage` | `RequireRole` via `/billing` parent | Yes, billing nav | `src/App.tsx:138`, `src/pages/billing/BillingLayout.tsx:52` |
| `/billing/review/:id` | `ReviewPage` | `RequireRole` via `/billing` parent | Yes, queue/review lists navigate here | `src/App.tsx:139`, `src/pages/billing/NeedsReviewPage.tsx:135` |
| `/billing/history` | `HistoryPage` | `RequireRole` via `/billing` parent | Yes, billing nav | `src/App.tsx:140`, `src/pages/billing/BillingLayout.tsx:53` |
| `/billing/new-order` | `BillingNewOrderLayout` index redirect to `items` | `RequireRole` via `/billing` parent | Yes, billing nav | `src/App.tsx:141`, `src/pages/billing/BillingLayout.tsx:38` |
| `/billing/new-order/items` | `NewOrderPage` | `RequireRole` via `/billing/new-order` parent | Yes, billing new-order redirect | `src/App.tsx:143`, `src/pages/billing/BillingNewOrderLayout.tsx:41` |
| `/billing/new-order/cart` | `CartPage` | `RequireRole` via `/billing/new-order` parent | Yes, billing new-order flow | `src/App.tsx:144`, `src/pages/billing/BillingNewOrderLayout.tsx:36` |
| `/billing/compact` | `CompactQueuePage` | `RequireRole` any selected role | No static navigation link found | `src/App.tsx:150` |
| `/picking` | `PickingLayout` + `QueuePage` index | `RequireRole` any selected role | Yes, role home and picking bottom nav | `src/App.tsx:160`, `src/App.tsx:167`, `src/pages/picking/PickingLayout.tsx:15` |
| `/picking/barcode-mapping` | `BarcodeMappingPage` | `RequireRole` via `/picking` parent | Yes, picking bottom nav | `src/App.tsx:168`, `src/pages/picking/PickingLayout.tsx:32` |
| `/picking/pick/:id` | `PickPage` | `RequireRole` via `/picking` parent | Yes, queue claim/resume navigates here | `src/App.tsx:169`, `src/pages/picking/QueuePage.tsx:113` |
| `/picking/preview/:id` | `PickPreviewPage` | `RequireRole` via `/picking` parent | No static direct link found; active-pick nav matches it | `src/App.tsx:170`, `src/pages/picking/PickingLayout.tsx:25` |
| `/admin-passcode` | `AdminPasscodePage` | `RequireAuth`; page itself redirects non-admin role to `/select-role` | Yes, admin guard redirect | `src/App.tsx:174`, `src/pages/admin/AdminPasscodePage.tsx:51` |
| `/admin` | `AdminPage` | `RequireRole`; `RequireAdminUnlock` only blocks selected admin role until passcode | Yes, role home | `src/App.tsx:184` |
| `/admin/upload` | `UploadPage` | Same as `/admin` | Yes, AdminPage link | `src/App.tsx:194`, `src/pages/admin/AdminPage.tsx:163` |
| `/admin/pack-catalog` | `PackCatalogPage` | Same as `/admin` | Yes, AdminPage link | `src/App.tsx:204`, `src/pages/admin/AdminPage.tsx:177` |
| `/admin/pareto-labels` | `ParetoLabelPrintPage` | Same as `/admin` | Yes, AdminPage link | `src/App.tsx:214`, `src/pages/admin/AdminPage.tsx:193` |
| `/admin/stock-audit-labels` | `StockAuditLabelPrintPage` | Same as `/admin` | Yes, AdminPage link | `src/App.tsx:224`, `src/pages/admin/AdminPage.tsx:209` |
| `/admin/labels` | `LabelStudioPage` | Same as `/admin` | Yes, AdminPage link | `src/App.tsx:234`, `src/pages/admin/AdminPage.tsx:225` |
| `/admin/cycle-count` | `CycleCountPage` | Same as `/admin` | Yes, AdminPage link | `src/App.tsx:244`, `src/pages/admin/AdminPage.tsx:81` |
| `/admin/barcode-mapping/import` | `ProcessChallanPage` | Same as `/admin` | Yes, BarcodeMappingPage link | `src/App.tsx:254`, `src/pages/admin/BarcodeMappingPage.tsx:576` |
| `/admin/barcode-mapping` | `BarcodeMappingPage` | Same as `/admin` | Yes, AdminPage link | `src/App.tsx:264`, `src/pages/admin/AdminPage.tsx:115` |
| `/admin/uom-onboarding` | `UomOnboardingPage` | Same as `/admin` | Yes, AdminPage link | `src/App.tsx:274`, `src/pages/admin/AdminPage.tsx:131` |
| `/admin/bin-onboarding` | `BinOnboardingPage` | Same as `/admin` | Yes, AdminPage link | `src/App.tsx:284`, `src/pages/admin/AdminPage.tsx:97` |
| `/admin/pick-scan-lab` | `PickScanLabPage` | Same as `/admin` | Yes, AdminPage and LabelStudio links | `src/App.tsx:294`, `src/pages/admin/AdminPage.tsx:243` |
| `/admin/ocr-lab` | `OcrOrderLabPage` | Same as `/admin` | Yes, AdminPage link | `src/App.tsx:304`, `src/pages/admin/AdminPage.tsx:259` |
| `/admin/supply` | `SupplyDemandPage` | Same as `/admin` | Yes, AdminPage link | `src/App.tsx:314`, `src/pages/admin/AdminPage.tsx:147` |
| `/admin/supply/sku/:itemId` | `SupplyDemandSkuDetailPage` | Same as `/admin` | Yes, SupplyDemandPage navigates here | `src/App.tsx:324`, `src/pages/admin/SupplyDemandPage.tsx:724` |
| `/admin/receiving` | `ReceivingJobsPage` | Same as `/admin` | Yes, AdminPage and Purchase links | `src/App.tsx:334`, `src/pages/admin/AdminPage.tsx:49` |
| `/admin/receiving/:jobId` | `ReceivingJobDetailPage` | Same as `/admin` | Yes, receiving/purchase flows navigate here | `src/App.tsx:344`, `src/pages/admin/receiving/ReceivingJobsPage.tsx:85` |
| `/purchase` | `PurchaseHomePage` | `RequireRole`; `RequireAdminUnlock` only blocks selected admin role until passcode | Yes, AdminPage link | `src/App.tsx:356`, `src/pages/admin/AdminPage.tsx:65` |
| `/purchase/new` | `PurchaseNewPoPage` | Same as `/purchase` | Yes, PurchaseHome link | `src/App.tsx:366`, `src/pages/purchase/PurchaseHomePage.tsx:38` |
| `/purchase/invoice/new` | `PurchaseInvoiceNewPage` | Same as `/purchase` | Yes, PurchaseHome link | `src/App.tsx:376`, `src/pages/purchase/PurchaseHomePage.tsx:47` |
| `/purchase/po/:poId` | `PurchasePoDetailPage` | Same as `/purchase` | Yes, PurchaseHome/NewPo flows navigate here | `src/App.tsx:386`, `src/pages/purchase/PurchaseHomePage.tsx:86` |
| `/purchase/po/:poId/invoice` | `PurchaseInvoiceReviewPage` | Same as `/purchase` | Yes, PurchasePoDetail link | `src/App.tsx:396`, `src/pages/purchase/PurchasePoDetailPage.tsx:173` |
| `*` | `Navigate` to `/` | Public catch-all redirect | Root/catch-all | `src/App.tsx:407` |

Routes that exist in the router but have no direct static navigation link pointing to the exact path:

- `/billing/compact` at `src/App.tsx:150`; standalone compact companion route.
- `/picking/preview/:id` at `src/App.tsx:170`; no direct static link found, but the picking nav active matcher includes preview paths at `src/pages/picking/PickingLayout.tsx:25`.

## SECTION 7 — COMPONENT QUALITY SCAN

### Over-300-Line Component/Page Files
- `src/pages/sales/NewOrderPage.tsx` — 2591 lines
- `src/pages/picking/PickPage.tsx` — 2223 lines
- `src/pages/admin/LabelStudioPage.tsx` — 2043 lines
- `src/pages/sales/CartPage.tsx` — 1805 lines
- `src/pages/admin/BinOnboardingPage.tsx` — 1777 lines
- `src/pages/admin/SupplyDemandPage.tsx` — 1473 lines
- `src/pages/billing/ReviewPage.tsx` — 1462 lines
- `src/pages/billing/LiveQueue/OrderSheetView.tsx` — 1433 lines
- `src/pages/admin/CycleCountPage.tsx` — 1312 lines
- `src/pages/sales/PendingRecoveryPage.tsx` — 1295 lines
- `src/pages/admin/BarcodeMappingPage.tsx` — 1291 lines
- `src/pages/sales/MyOrdersPage.tsx` — 1081 lines
- `src/pages/admin/PackCatalogPage.tsx` — 1077 lines
- `src/pages/admin/PickScanLabPage.tsx` — 994 lines
- `src/pages/billing/CompactQueuePage.tsx` — 964 lines
- `src/pages/billing/LiveQueuePage.tsx` — 963 lines
- `src/components/shared/LiveQrScanner.tsx` — 782 lines
- `src/pages/admin/receiving/ReceivingJobDetailPage.tsx` — 756 lines
- `src/pages/admin/receiving/PutawayScanWizard.tsx` — 667 lines
- `src/components/receiving/ReceivingGrnLineCard.tsx` — 602 lines
- `src/components/receiving/ReceivingGatePanel.tsx` — 580 lines
- `src/pages/picking/QueueSheet.tsx` — 568 lines
- `src/components/receiving/ReceivingSortPanel.tsx` — 558 lines
- `src/pages/admin/UomOnboardingPage.tsx` — 495 lines
- `src/pages/billing/LiveQueue/ProcessView.tsx` — 439 lines
- `src/pages/billing/LiveQueue/QueueView.tsx` — 431 lines
- `src/pages/admin/receiving/ReceivingSkuCard.tsx` — 429 lines
- `src/pages/admin/StockAuditLabelPrintPage.tsx` — 421 lines
- `src/pages/admin/ParetoLabelPrintPage.tsx` — 413 lines
- `src/App.tsx` — 411 lines
- `src/components/picking/SwipeDeck.tsx` — 400 lines
- `src/pages/admin/SupplyDemandSkuDetailPage.tsx` — 395 lines
- `src/components/notifications/NotificationBell.tsx` — 392 lines
- `src/pages/billing/DashboardPage.tsx` — 388 lines
- `src/pages/admin/ProcessChallanPage.tsx` — 381 lines
- `src/pages/billing/RejectedPage.tsx` — 377 lines
- `src/pages/billing/HistoryPage.tsx` — 370 lines
- `src/pages/picking/QueuePage.tsx` — 364 lines
- `src/pages/purchase/PurchaseInvoiceReviewPage.tsx` — 362 lines
- `src/pages/purchase/PurchaseInvoiceNewPage.tsx` — 356 lines
- `src/pages/sales/SalesHome.tsx` — 353 lines
- `src/pages/billing/LiveQueue/AddLineSheet.tsx` — 346 lines
- `src/pages/sales/SalesEditAddLineSheet.tsx` — 346 lines
- `src/pages/admin/UploadPage.tsx` — 340 lines

### Component Responsibility / Mixed Concerns

| Component file | Single clear responsibility? | Over 300 lines? | Mixes fetch + business + render? | Touch-target scan |
|---|---|---:|---:|---|
| `src/App.tsx` | no/mixed | yes | no | ok by scanner |
| `src/components/PwaUpdatePrompt.tsx` | yes | no | no | possible implicit sizing at `src/components/PwaUpdatePrompt.tsx:29` |
| `src/components/admin/StagingPromotePanel.tsx` | no/mixed | no | yes | possible implicit sizing at `src/components/admin/StagingPromotePanel.tsx:57` |
| `src/components/billing/FulfillmentPathSelector.tsx` | yes | no | no | possible implicit sizing at `src/components/billing/FulfillmentPathSelector.tsx:56`, `src/components/billing/FulfillmentPathSelector.tsx:59`, `src/components/billing/FulfillmentPathSelector.tsx:76`, `src/components/billing/FulfillmentPathSelector.tsx:79` |
| `src/components/dev/DevRoleSwitcher.tsx` | yes | no | no | possible implicit sizing at `src/components/dev/DevRoleSwitcher.tsx:57`, `src/components/dev/DevRoleSwitcher.tsx:60`, `src/components/dev/DevRoleSwitcher.tsx:74`, `src/components/dev/DevRoleSwitcher.tsx:76` |
| `src/components/notifications/NotificationBell.tsx` | no/mixed | yes | no | possible implicit sizing at `src/components/notifications/NotificationBell.tsx:225`, `src/components/notifications/NotificationBell.tsx:228`, `src/components/notifications/NotificationBell.tsx:262`, `src/components/notifications/NotificationBell.tsx:264` |
| `src/components/notifications/NotificationDiagnosticsPanel.tsx` | yes | no | no | possible implicit sizing at `src/components/notifications/NotificationDiagnosticsPanel.tsx:34`, `src/components/notifications/NotificationDiagnosticsPanel.tsx:36` |
| `src/components/notifications/PushAlertsCompact.tsx` | yes | no | no | possible implicit sizing at `src/components/notifications/PushAlertsCompact.tsx:33`, `src/components/notifications/PushAlertsCompact.tsx:35`, `src/components/notifications/PushAlertsCompact.tsx:49`, `src/components/notifications/PushAlertsCompact.tsx:51` |
| `src/components/packCatalog/PrecutSheetPreview.tsx` | yes | no | no | possible implicit sizing at `src/components/packCatalog/PrecutSheetPreview.tsx:141`, `src/components/packCatalog/PrecutSheetPreview.tsx:144` |
| `src/components/picking/AvailableOrderRow.tsx` | yes | no | no | possible implicit sizing at `src/components/picking/AvailableOrderRow.tsx:20`, `src/components/picking/AvailableOrderRow.tsx:22` |
| `src/components/picking/BeingPickedCard.tsx` | yes | no | no | possible implicit sizing at `src/components/picking/BeingPickedCard.tsx:102`, `src/components/picking/BeingPickedCard.tsx:104` |
| `src/components/picking/BeingPickedCarousel.tsx` | yes | no | no | possible implicit sizing at `src/components/picking/BeingPickedCarousel.tsx:60`, `src/components/picking/BeingPickedCarousel.tsx:66` |
| `src/components/picking/BrandLineChip.tsx` | yes | no | no | ok by scanner |
| `src/components/picking/CardHero.tsx` | yes | no | no | possible implicit sizing at `src/components/picking/CardHero.tsx:62`, `src/components/picking/CardHero.tsx:64` |
| `src/components/picking/FlagReasonSheet.tsx` | yes | no | no | possible implicit sizing at `src/components/picking/FlagReasonSheet.tsx:63`, `src/components/picking/FlagReasonSheet.tsx:66`, `src/components/picking/FlagReasonSheet.tsx:108` |
| `src/components/picking/JumpListSheet.tsx` | yes | no | no | ok by scanner |
| `src/components/picking/PickCard.tsx` | yes | no | no | possible implicit sizing at `src/components/picking/PickCard.tsx:104`, `src/components/picking/PickCard.tsx:106` |
| `src/components/picking/PickCardCTAs.tsx` | yes | no | no | possible implicit sizing at `src/components/picking/PickCardCTAs.tsx:26`, `src/components/picking/PickCardCTAs.tsx:29`, `src/components/picking/PickCardCTAs.tsx:35`, `src/components/picking/PickCardCTAs.tsx:38` |
| `src/components/picking/PickQueuePartyBlock.tsx` | yes | no | no | ok by scanner |
| `src/components/picking/SwipeDeck.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/components/picking/SwipeDeck.tsx:378`, `src/components/picking/SwipeDeck.tsx:384` |
| `src/components/picking/TransportChip.tsx` | yes | no | no | ok by scanner |
| `src/components/receiving/ReceivingGatePanel.tsx` | no/mixed | yes | yes | ok by scanner |
| `src/components/receiving/ReceivingGrnLineCard.tsx` | no/mixed | yes | yes | ok by scanner |
| `src/components/receiving/ReceivingGrnTable.tsx` | yes | no | no | possible implicit sizing at `src/components/receiving/ReceivingGrnTable.tsx:82`, `src/components/receiving/ReceivingGrnTable.tsx:85` |
| `src/components/receiving/ReceivingSortPanel.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/components/receiving/ReceivingSortPanel.tsx:423` |
| `src/components/receiving/ReceivingStepper.tsx` | yes | no | no | possible implicit sizing at `src/components/receiving/ReceivingStepper.tsx:48`, `src/components/receiving/ReceivingStepper.tsx:52` |
| `src/components/shared/AliasChip.tsx` | yes | no | no | ok by scanner |
| `src/components/shared/AttributionChips.tsx` | yes | no | no | ok by scanner |
| `src/components/shared/BigButton.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/BigButton.tsx:37` |
| `src/components/shared/BottomNav.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/BottomNav.tsx:56`, `src/components/shared/BottomNav.tsx:130` |
| `src/components/shared/BottomSheet.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/BottomSheet.tsx:164`, `src/components/shared/BottomSheet.tsx:193`, `src/components/shared/BottomSheet.tsx:195` |
| `src/components/shared/Card.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/Card.tsx:12`, `src/components/shared/Card.tsx:19`, `src/components/shared/Card.tsx:25` |
| `src/components/shared/EmptyState.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/EmptyState.tsx:6` |
| `src/components/shared/FilterChip.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/FilterChip.tsx:7`, `src/components/shared/FilterChip.tsx:9`, `src/components/shared/FilterChip.tsx:17`, `src/components/shared/FilterChip.tsx:23` |
| `src/components/shared/InitialsAvatar.tsx` | yes | no | no | ok by scanner |
| `src/components/shared/InlineQtyEditor.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/InlineQtyEditor.tsx:147`, `src/components/shared/InlineQtyEditor.tsx:149`, `src/components/shared/InlineQtyEditor.tsx:182`, `src/components/shared/InlineQtyEditor.tsx:184` |
| `src/components/shared/LiveQrScanner.tsx` | no/mixed | yes | no | possible implicit sizing at `src/components/shared/LiveQrScanner.tsx:597`, `src/components/shared/LiveQrScanner.tsx:599`, `src/components/shared/LiveQrScanner.tsx:610`, `src/components/shared/LiveQrScanner.tsx:612` |
| `src/components/shared/NumberStepper.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/NumberStepper.tsx:62`, `src/components/shared/NumberStepper.tsx:64`, `src/components/shared/NumberStepper.tsx:74`, `src/components/shared/NumberStepper.tsx:83` |
| `src/components/shared/PageHeader.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/PageHeader.tsx:21`, `src/components/shared/PageHeader.tsx:22` |
| `src/components/shared/ProgressBar.tsx` | yes | no | no | ok by scanner |
| `src/components/shared/QueueDayTag.tsx` | yes | no | no | ok by scanner |
| `src/components/shared/QueueSectionHeader.tsx` | yes | no | no | ok by scanner |
| `src/components/shared/SalespersonSelectorSheet.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/SalespersonSelectorSheet.tsx:75`, `src/components/shared/SalespersonSelectorSheet.tsx:77`, `src/components/shared/SalespersonSelectorSheet.tsx:128`, `src/components/shared/SalespersonSelectorSheet.tsx:131` |
| `src/components/shared/SearchInput.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/SearchInput.tsx:120`, `src/components/shared/SearchInput.tsx:145`, `src/components/shared/SearchInput.tsx:149` |
| `src/components/shared/SearchableTransportDropdown.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/SearchableTransportDropdown.tsx:68`, `src/components/shared/SearchableTransportDropdown.tsx:127`, `src/components/shared/SearchableTransportDropdown.tsx:129`, `src/components/shared/SearchableTransportDropdown.tsx:167` |
| `src/components/shared/SelectTrigger.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/SelectTrigger.tsx:11`, `src/components/shared/SelectTrigger.tsx:28`, `src/components/shared/SelectTrigger.tsx:38`, `src/components/shared/SelectTrigger.tsx:41` |
| `src/components/shared/Skeleton.tsx` | no/mixed | no | yes | ok by scanner |
| `src/components/shared/StatusBadge.tsx` | yes | no | no | ok by scanner |
| `src/components/shared/Toast.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/Toast.tsx:30`, `src/components/shared/Toast.tsx:46`, `src/components/shared/Toast.tsx:47`, `src/components/shared/Toast.tsx:53` |
| `src/components/shared/scanner/CollectResultSheet.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/scanner/CollectResultSheet.tsx:51`, `src/components/shared/scanner/CollectResultSheet.tsx:97`, `src/components/shared/scanner/CollectResultSheet.tsx:99` |
| `src/components/shared/scanner/PickScanLabResultSheet.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/scanner/PickScanLabResultSheet.tsx:40`, `src/components/shared/scanner/PickScanLabResultSheet.tsx:86`, `src/components/shared/scanner/PickScanLabResultSheet.tsx:88` |
| `src/components/shared/scanner/ScannerControls.tsx` | yes | no | no | possible implicit sizing at `src/components/shared/scanner/ScannerControls.tsx:30`, `src/components/shared/scanner/ScannerControls.tsx:32`, `src/components/shared/scanner/ScannerControls.tsx:42`, `src/components/shared/scanner/ScannerControls.tsx:44` |
| `src/components/shared/scanner/ViewfinderOverlay.tsx` | yes | no | no | ok by scanner |
| `src/pages/LoginPage.tsx` | yes | no | no | possible implicit sizing at `src/pages/LoginPage.tsx:92`, `src/pages/LoginPage.tsx:94`, `src/pages/LoginPage.tsx:101`, `src/pages/LoginPage.tsx:102` |
| `src/pages/RoleSelectPage.tsx` | yes | no | no | possible implicit sizing at `src/pages/RoleSelectPage.tsx:99`, `src/pages/RoleSelectPage.tsx:101`, `src/pages/RoleSelectPage.tsx:126`, `src/pages/RoleSelectPage.tsx:127` |
| `src/pages/admin/AdminPage.tsx` | yes | no | no | possible implicit sizing at `src/pages/admin/AdminPage.tsx:30`, `src/pages/admin/AdminPage.tsx:31`, `src/pages/admin/AdminPage.tsx:47`, `src/pages/admin/AdminPage.tsx:49` |
| `src/pages/admin/AdminPasscodePage.tsx` | yes | no | no | possible implicit sizing at `src/pages/admin/AdminPasscodePage.tsx:89`, `src/pages/admin/AdminPasscodePage.tsx:91`, `src/pages/admin/AdminPasscodePage.tsx:98`, `src/pages/admin/AdminPasscodePage.tsx:99` |
| `src/pages/admin/BarcodeMappingPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/admin/BarcodeMappingPage.tsx:558`, `src/pages/admin/BarcodeMappingPage.tsx:560`, `src/pages/admin/BarcodeMappingPage.tsx:574`, `src/pages/admin/BarcodeMappingPage.tsx:576` |
| `src/pages/admin/BinOnboardingPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/admin/BinOnboardingPage.tsx:177`, `src/pages/admin/BinOnboardingPage.tsx:180`, `src/pages/admin/BinOnboardingPage.tsx:197` |
| `src/pages/admin/CycleCountPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/admin/CycleCountPage.tsx:272`, `src/pages/admin/CycleCountPage.tsx:274`, `src/pages/admin/CycleCountPage.tsx:281`, `src/pages/admin/CycleCountPage.tsx:283` |
| `src/pages/admin/LabelStudioPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/admin/LabelStudioPage.tsx:541`, `src/pages/admin/LabelStudioPage.tsx:1032`, `src/pages/admin/LabelStudioPage.tsx:1034`, `src/pages/admin/LabelStudioPage.tsx:1040` |
| `src/pages/admin/OcrOrderLabPage.tsx` | yes | no | no | ok by scanner |
| `src/pages/admin/PackCatalogPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/admin/PackCatalogPage.tsx:513`, `src/pages/admin/PackCatalogPage.tsx:515` |
| `src/pages/admin/ParetoLabelPrintPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/admin/ParetoLabelPrintPage.tsx:198`, `src/pages/admin/ParetoLabelPrintPage.tsx:200`, `src/pages/admin/ParetoLabelPrintPage.tsx:206` |
| `src/pages/admin/PickScanLabPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/admin/PickScanLabPage.tsx:382`, `src/pages/admin/PickScanLabPage.tsx:383`, `src/pages/admin/PickScanLabPage.tsx:403`, `src/pages/admin/PickScanLabPage.tsx:406` |
| `src/pages/admin/ProcessChallanPage.tsx` | no/mixed | yes | no | possible implicit sizing at `src/pages/admin/ProcessChallanPage.tsx:224`, `src/pages/admin/ProcessChallanPage.tsx:226`, `src/pages/admin/ProcessChallanPage.tsx:259` |
| `src/pages/admin/StockAuditLabelPrintPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/admin/StockAuditLabelPrintPage.tsx:200`, `src/pages/admin/StockAuditLabelPrintPage.tsx:202`, `src/pages/admin/StockAuditLabelPrintPage.tsx:255` |
| `src/pages/admin/SupplyDemandPage.tsx` | no/mixed | yes | no | possible implicit sizing at `src/pages/admin/SupplyDemandPage.tsx:228`, `src/pages/admin/SupplyDemandPage.tsx:234`, `src/pages/admin/SupplyDemandPage.tsx:238`, `src/pages/admin/SupplyDemandPage.tsx:240` |
| `src/pages/admin/SupplyDemandSkuDetailPage.tsx` | no/mixed | yes | no | possible implicit sizing at `src/pages/admin/SupplyDemandSkuDetailPage.tsx:250`, `src/pages/admin/SupplyDemandSkuDetailPage.tsx:252`, `src/pages/admin/SupplyDemandSkuDetailPage.tsx:268`, `src/pages/admin/SupplyDemandSkuDetailPage.tsx:270` |
| `src/pages/admin/UomOnboardingPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/admin/UomOnboardingPage.tsx:244`, `src/pages/admin/UomOnboardingPage.tsx:246`, `src/pages/admin/UomOnboardingPage.tsx:274` |
| `src/pages/admin/UploadPage.tsx` | no/mixed | yes | no | possible implicit sizing at `src/pages/admin/UploadPage.tsx:170`, `src/pages/admin/UploadPage.tsx:171`, `src/pages/admin/UploadPage.tsx:190` |
| `src/pages/admin/ocr-lab/OcrLabEditDrawer.tsx` | yes | no | no | possible implicit sizing at `src/pages/admin/ocr-lab/OcrLabEditDrawer.tsx:46` |
| `src/pages/admin/ocr-lab/OcrLabHomeScreen.tsx` | yes | no | no | possible implicit sizing at `src/pages/admin/ocr-lab/OcrLabHomeScreen.tsx:25`, `src/pages/admin/ocr-lab/OcrLabHomeScreen.tsx:26` |
| `src/pages/admin/ocr-lab/OcrLabReviewScreen.tsx` | yes | no | no | possible implicit sizing at `src/pages/admin/ocr-lab/OcrLabReviewScreen.tsx:70`, `src/pages/admin/ocr-lab/OcrLabReviewScreen.tsx:71`, `src/pages/admin/ocr-lab/OcrLabReviewScreen.tsx:77`, `src/pages/admin/ocr-lab/OcrLabReviewScreen.tsx:78` |
| `src/pages/admin/ocr-lab/OcrLabScanningScreen.tsx` | yes | no | no | ok by scanner |
| `src/pages/admin/ocr-lab/OcrLabSummaryScreen.tsx` | yes | no | no | possible implicit sizing at `src/pages/admin/ocr-lab/OcrLabSummaryScreen.tsx:64`, `src/pages/admin/ocr-lab/OcrLabSummaryScreen.tsx:65` |
| `src/pages/admin/ocr-lab/OcrLabUploadScreen.tsx` | yes | no | no | possible implicit sizing at `src/pages/admin/ocr-lab/OcrLabUploadScreen.tsx:86`, `src/pages/admin/ocr-lab/OcrLabUploadScreen.tsx:87` |
| `src/pages/admin/receiving/PutawayScanWizard.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/admin/receiving/PutawayScanWizard.tsx:384` |
| `src/pages/admin/receiving/ReceivingJobDetailPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/admin/receiving/ReceivingJobDetailPage.tsx:330`, `src/pages/admin/receiving/ReceivingJobDetailPage.tsx:332` |
| `src/pages/admin/receiving/ReceivingJobsPage.tsx` | no/mixed | no | yes | possible implicit sizing at `src/pages/admin/receiving/ReceivingJobsPage.tsx:108`, `src/pages/admin/receiving/ReceivingJobsPage.tsx:110`, `src/pages/admin/receiving/ReceivingJobsPage.tsx:187` |
| `src/pages/admin/receiving/ReceivingSkuCard.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/admin/receiving/ReceivingSkuCard.tsx:256`, `src/pages/admin/receiving/ReceivingSkuCard.tsx:260`, `src/pages/admin/receiving/ReceivingSkuCard.tsx:278` |
| `src/pages/billing/BillingLayout.tsx` | yes | no | no | possible implicit sizing at `src/pages/billing/BillingLayout.tsx:79`, `src/pages/billing/BillingLayout.tsx:81` |
| `src/pages/billing/BillingNewOrderLayout.tsx` | yes | no | no | possible implicit sizing at `src/pages/billing/BillingNewOrderLayout.tsx:48`, `src/pages/billing/BillingNewOrderLayout.tsx:50`, `src/pages/billing/BillingNewOrderLayout.tsx:113`, `src/pages/billing/BillingNewOrderLayout.tsx:115` |
| `src/pages/billing/CompactQueuePage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/billing/CompactQueuePage.tsx:80`, `src/pages/billing/CompactQueuePage.tsx:82`, `src/pages/billing/CompactQueuePage.tsx:115`, `src/pages/billing/CompactQueuePage.tsx:116` |
| `src/pages/billing/DashboardPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/billing/DashboardPage.tsx:62`, `src/pages/billing/DashboardPage.tsx:68`, `src/pages/billing/DashboardPage.tsx:72`, `src/pages/billing/DashboardPage.tsx:74` |
| `src/pages/billing/HistoryPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/billing/HistoryPage.tsx:106`, `src/pages/billing/HistoryPage.tsx:108` |
| `src/pages/billing/LiveQueue/AddLineSheet.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/billing/LiveQueue/AddLineSheet.tsx:196`, `src/pages/billing/LiveQueue/AddLineSheet.tsx:198`, `src/pages/billing/LiveQueue/AddLineSheet.tsx:237`, `src/pages/billing/LiveQueue/AddLineSheet.tsx:240` |
| `src/pages/billing/LiveQueue/CommitView.tsx` | yes | no | no | possible implicit sizing at `src/pages/billing/LiveQueue/CommitView.tsx:56`, `src/pages/billing/LiveQueue/CommitView.tsx:57`, `src/pages/billing/LiveQueue/CommitView.tsx:148`, `src/pages/billing/LiveQueue/CommitView.tsx:149` |
| `src/pages/billing/LiveQueue/CommunicateView.tsx` | yes | no | no | possible implicit sizing at `src/pages/billing/LiveQueue/CommunicateView.tsx:58`, `src/pages/billing/LiveQueue/CommunicateView.tsx:59`, `src/pages/billing/LiveQueue/CommunicateView.tsx:75`, `src/pages/billing/LiveQueue/CommunicateView.tsx:76` |
| `src/pages/billing/LiveQueue/CompleteView.tsx` | yes | no | no | ok by scanner |
| `src/pages/billing/LiveQueue/OrderSheetView.tsx` | no/mixed | yes | no | possible implicit sizing at `src/pages/billing/LiveQueue/OrderSheetView.tsx:569`, `src/pages/billing/LiveQueue/OrderSheetView.tsx:570`, `src/pages/billing/LiveQueue/OrderSheetView.tsx:641`, `src/pages/billing/LiveQueue/OrderSheetView.tsx:642` |
| `src/pages/billing/LiveQueue/OrientView.tsx` | yes | no | no | possible implicit sizing at `src/pages/billing/LiveQueue/OrientView.tsx:40`, `src/pages/billing/LiveQueue/OrientView.tsx:42` |
| `src/pages/billing/LiveQueue/ProcessView.tsx` | no/mixed | yes | no | possible implicit sizing at `src/pages/billing/LiveQueue/ProcessView.tsx:179`, `src/pages/billing/LiveQueue/ProcessView.tsx:199`, `src/pages/billing/LiveQueue/ProcessView.tsx:264`, `src/pages/billing/LiveQueue/ProcessView.tsx:265` |
| `src/pages/billing/LiveQueue/QueueView.tsx` | no/mixed | yes | no | possible implicit sizing at `src/pages/billing/LiveQueue/QueueView.tsx:61`, `src/pages/billing/LiveQueue/QueueView.tsx:69`, `src/pages/billing/LiveQueue/QueueView.tsx:82`, `src/pages/billing/LiveQueue/QueueView.tsx:83` |
| `src/pages/billing/LiveQueue/ReportView.tsx` | yes | no | no | possible implicit sizing at `src/pages/billing/LiveQueue/ReportView.tsx:119`, `src/pages/billing/LiveQueue/ReportView.tsx:120`, `src/pages/billing/LiveQueue/ReportView.tsx:158`, `src/pages/billing/LiveQueue/ReportView.tsx:159` |
| `src/pages/billing/LiveQueue/ResolveView.tsx` | yes | no | no | possible implicit sizing at `src/pages/billing/LiveQueue/ResolveView.tsx:67`, `src/pages/billing/LiveQueue/ResolveView.tsx:69`, `src/pages/billing/LiveQueue/ResolveView.tsx:79`, `src/pages/billing/LiveQueue/ResolveView.tsx:81` |
| `src/pages/billing/LiveQueuePage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/billing/LiveQueuePage.tsx:807`, `src/pages/billing/LiveQueuePage.tsx:809` |
| `src/pages/billing/NeedsReviewPage.tsx` | yes | no | no | ok by scanner |
| `src/pages/billing/PendingPage.tsx` | yes | no | no | possible implicit sizing at `src/pages/billing/PendingPage.tsx:20` |
| `src/pages/billing/RejectedPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/billing/RejectedPage.tsx:88`, `src/pages/billing/RejectedPage.tsx:90`, `src/pages/billing/RejectedPage.tsx:244`, `src/pages/billing/RejectedPage.tsx:247` |
| `src/pages/billing/ReviewPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/billing/ReviewPage.tsx:660`, `src/pages/billing/ReviewPage.tsx:787`, `src/pages/billing/ReviewPage.tsx:789`, `src/pages/billing/ReviewPage.tsx:807` |
| `src/pages/picking/PickCompleteScreen.tsx` | yes | no | no | possible implicit sizing at `src/pages/picking/PickCompleteScreen.tsx:80` |
| `src/pages/picking/PickPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/picking/PickPage.tsx:1580`, `src/pages/picking/PickPage.tsx:1597` |
| `src/pages/picking/PickPreviewPage.tsx` | yes | no | no | possible implicit sizing at `src/pages/picking/PickPreviewPage.tsx:117`, `src/pages/picking/PickPreviewPage.tsx:119` |
| `src/pages/picking/PickingLayout.tsx` | yes | no | no | possible implicit sizing at `src/pages/picking/PickingLayout.tsx:58`, `src/pages/picking/PickingLayout.tsx:60` |
| `src/pages/picking/QueuePage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/picking/QueuePage.tsx:208`, `src/pages/picking/QueuePage.tsx:210`, `src/pages/picking/QueuePage.tsx:220`, `src/pages/picking/QueuePage.tsx:222` |
| `src/pages/picking/QueueSheet.tsx` | no/mixed | yes | no | possible implicit sizing at `src/pages/picking/QueueSheet.tsx:253`, `src/pages/picking/QueueSheet.tsx:255`, `src/pages/picking/QueueSheet.tsx:270` |
| `src/pages/purchase/PurchaseHomePage.tsx` | no/mixed | no | yes | possible implicit sizing at `src/pages/purchase/PurchaseHomePage.tsx:20`, `src/pages/purchase/PurchaseHomePage.tsx:22`, `src/pages/purchase/PurchaseHomePage.tsx:38` |
| `src/pages/purchase/PurchaseInvoiceNewPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/purchase/PurchaseInvoiceNewPage.tsx:133`, `src/pages/purchase/PurchaseInvoiceNewPage.tsx:135` |
| `src/pages/purchase/PurchaseInvoiceReviewPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/purchase/PurchaseInvoiceReviewPage.tsx:155`, `src/pages/purchase/PurchaseInvoiceReviewPage.tsx:157` |
| `src/pages/purchase/PurchaseNewPoPage.tsx` | no/mixed | no | yes | possible implicit sizing at `src/pages/purchase/PurchaseNewPoPage.tsx:131`, `src/pages/purchase/PurchaseNewPoPage.tsx:133` |
| `src/pages/purchase/PurchasePoDetailPage.tsx` | no/mixed | no | yes | possible implicit sizing at `src/pages/purchase/PurchasePoDetailPage.tsx:120`, `src/pages/purchase/PurchasePoDetailPage.tsx:122` |
| `src/pages/purchase/PurchasePoPreviewTable.tsx` | yes | no | no | possible implicit sizing at `src/pages/purchase/PurchasePoPreviewTable.tsx:100`, `src/pages/purchase/PurchasePoPreviewTable.tsx:104` |
| `src/pages/sales/CartPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/sales/CartPage.tsx:250`, `src/pages/sales/CartPage.tsx:329`, `src/pages/sales/CartPage.tsx:331` |
| `src/pages/sales/MyOrdersPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/sales/MyOrdersPage.tsx:359`, `src/pages/sales/MyOrdersPage.tsx:402`, `src/pages/sales/MyOrdersPage.tsx:407`, `src/pages/sales/MyOrdersPage.tsx:419` |
| `src/pages/sales/NewOrderPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/sales/NewOrderPage.tsx:137`, `src/pages/sales/NewOrderPage.tsx:138`, `src/pages/sales/NewOrderPage.tsx:151`, `src/pages/sales/NewOrderPage.tsx:153` |
| `src/pages/sales/PendingRecoveryPage.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/sales/PendingRecoveryPage.tsx:400`, `src/pages/sales/PendingRecoveryPage.tsx:402`, `src/pages/sales/PendingRecoveryPage.tsx:457`, `src/pages/sales/PendingRecoveryPage.tsx:459` |
| `src/pages/sales/SalesChromeContext.tsx` | yes | no | no | ok by scanner |
| `src/pages/sales/SalesEditAddLineSheet.tsx` | no/mixed | yes | yes | possible implicit sizing at `src/pages/sales/SalesEditAddLineSheet.tsx:196`, `src/pages/sales/SalesEditAddLineSheet.tsx:198`, `src/pages/sales/SalesEditAddLineSheet.tsx:237`, `src/pages/sales/SalesEditAddLineSheet.tsx:240` |
| `src/pages/sales/SalesHome.tsx` | no/mixed | yes | no | ok by scanner |
| `src/pages/sales/SalesLayout.tsx` | yes | no | no | ok by scanner |

## SECTION 8 — WHAT TO KILL

- Partially built / lab-like features: OCR Order Lab (`src/pages/admin/OcrOrderLabPage.tsx:1`), nested OCR lab screens under `src/pages/admin/ocr-lab/`, Pick Scan Lab (`src/pages/admin/PickScanLabPage.tsx:1`), and stock/label print utility screens (`src/pages/admin/ParetoLabelPrintPage.tsx:1`, `src/pages/admin/StockAuditLabelPrintPage.tsx:1`) are admin-linked but not core daily order/pick workflow.
- Hardcoded/mock/demo paths: `src/components/dev/DevRoleSwitcher.tsx:34` selects demo users; `src/pages/RoleSelectPage.tsx:48` explicitly falls back to hardcoded constants when DB users are unavailable.
- Query key definitions/usages that look isolated or highly local:
  - `src/components/admin/StagingPromotePanel.tsx:24` — `queryKey: ['stagingLayers', busyCode], queryFn: () => fetchStagingLayersForBusy(busyCode), enabled: Number.isFinite(busyCode) && busyCode > 0, });  if (isStagingBinId(targetBinId)) return null;`
  - `src/components/admin/StagingPromotePanel.tsx:73` — `void qc.invalidateQueries({ queryKey: ['stagingLayers', busyCode] }); } catch { toast.error('Move failed'); } finally { setMovingId(null); }`
  - `src/lib/purchase/purchaseApi.ts:373` — `export const RECEIVING_HUB_POS_QUERY_KEY = ['purchase', 'receiving-hub', 'sent-pos'] as const;`
  - `src/lib/wms.ts:4` — `export const BIN_INVENTORY_QUERY_KEY = ['wms', 'bin-inventory'] as const;`
  - `src/lib/wms.ts:5` — `export const PENDING_BIN_COUNTS_QUERY_KEY = ['wms', 'pending-bin-counts'] as const;`
  - `src/pages/admin/BarcodeMappingPage.tsx:68` — `const BARCODE_COVERAGE_QUERY_KEY = ['barcode-coverage'] as const;`
  - `src/pages/admin/BarcodeMappingPage.tsx:70` — `const MAPPED_SKUS_QUERY_KEY = ['barcode-mapped-skus'] as const;`
  - `src/pages/admin/BarcodeMappingPage.tsx:267` — `queryKey: BARCODE_COVERAGE_QUERY_KEY, queryFn: fetchBarcodeCoverage, staleTime: 30_000, }); const { data: rackCoverage, isLoading: rackCoverageLoading } = useQuery({ queryKey: BARCODE_RACK_COVERAGE_QUERY_KEY,`
  - `src/pages/admin/BarcodeMappingPage.tsx:272` — `queryKey: BARCODE_RACK_COVERAGE_QUERY_KEY, queryFn: fetchBarcodeRackCoverage, staleTime: 30_000, }); const { data: mappedSkuSummaries = [] } = useQuery({ queryKey: MAPPED_SKUS_QUERY_KEY,`
  - `src/pages/admin/BarcodeMappingPage.tsx:277` — `queryKey: MAPPED_SKUS_QUERY_KEY, queryFn: fetchMappedSkuSummaries, staleTime: 30_000, }); const mappedSkuSet = useMemo( () => new Set(mappedSkuSummaries.map((entry) => entry.skuBusyCode)),`
  - `src/pages/admin/BarcodeMappingPage.tsx:368` — `void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_QUERY_KEY }); toast.info('Multiple SKUs found in this bin. Choose the one you are mapping.'); } catch (error) { const message = error instanceof Error ? error.me`
  - `src/pages/admin/BarcodeMappingPage.tsx:479` — `void queryClient.invalidateQueries({ queryKey: BARCODE_COVERAGE_QUERY_KEY }); void queryClient.invalidateQueries({ queryKey: BARCODE_RACK_COVERAGE_QUERY_KEY }); void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_`
  - `src/pages/admin/BarcodeMappingPage.tsx:480` — `void queryClient.invalidateQueries({ queryKey: BARCODE_RACK_COVERAGE_QUERY_KEY }); void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_QUERY_KEY });  // Patch the live scan index so the scanner resolves this barco`
  - `src/pages/admin/BarcodeMappingPage.tsx:481` — `void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_QUERY_KEY });  // Patch the live scan index so the scanner resolves this barcode immediately // in the current browser session without waiting for a full index r`
  - `src/pages/admin/BinOnboardingPage.tsx:306` — `await queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY }); await queryClient.invalidateQueries({ queryKey: BIN_INVENTORY_QUERY_KEY }); setQuickPlaceBin(''); setQuickPlaceSkuBusy(''); }, onError: () =>`
  - `src/pages/admin/BinOnboardingPage.tsx:307` — `await queryClient.invalidateQueries({ queryKey: BIN_INVENTORY_QUERY_KEY }); setQuickPlaceBin(''); setQuickPlaceSkuBusy(''); }, onError: () => toast.error('Could not assign bin.'), });`
  - `src/pages/admin/BinOnboardingPage.tsx:373` — `queryKey: MAPPED_SKUS_KEY, queryFn: fetchMappedSkuSummaries, staleTime: 60_000, });  const mappedSkuSet = useMemo(() => {`
  - `src/pages/admin/BinOnboardingPage.tsx:387` — `queryKey: BARCODE_COV_KEY, queryFn: fetchBarcodeCoverage, staleTime: 60_000, });  const { data: uomGaps = [] } = useQuery({`
  - `src/pages/admin/BinOnboardingPage.tsx:599` — `void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_KEY }); setScannerOpen(null); toast.success(`${tier} label saved (${displayKey}).`); }, [ selectedSku,`
  - `src/pages/admin/BinOnboardingPage.tsx:666` — `void queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_KEY }); toast.success(`${tier} label forced for this SKU (${displayKey}).`); }, [tierConflict, selectedSku, manufacturer, userId, userName, toast, queryClient]);`
  - `src/pages/admin/BinOnboardingPage.tsx:741` — `queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: UOM_GAPS_KEY }), queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_KEY }), ]);  setSessionStats((s) => ({`
  - `src/pages/admin/BinOnboardingPage.tsx:742` — `queryClient.invalidateQueries({ queryKey: UOM_GAPS_KEY }), queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_KEY }), ]);  setSessionStats((s) => ({ ...s,`
  - `src/pages/admin/BinOnboardingPage.tsx:743` — `queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_KEY }), ]);  setSessionStats((s) => ({ ...s, uomConfirmed: s.uomConfirmed + (wasConfirmed ? 0 : 1),`
  - `src/pages/admin/CycleCountPage.tsx:309` — `queryKey: BIN_INVENTORY_QUERY_KEY, queryFn: fetchBinInventory, });  const { data: pendingCounts = [], isLoading: pendingLoading } = useQuery({ queryKey: PENDING_BIN_COUNTS_QUERY_KEY,`
  - `src/pages/admin/CycleCountPage.tsx:314` — `queryKey: PENDING_BIN_COUNTS_QUERY_KEY, queryFn: fetchPendingBinCounts, });  const { data: packDefinitions = [] } = useQuery({ queryKey: PACK_DEFINITIONS_QUERY_KEY,`
  - `src/pages/admin/CycleCountPage.tsx:383` — `queryClient.invalidateQueries({ queryKey: BIN_INVENTORY_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: PENDING_BIN_COUNTS_QUERY_KEY }), ]); };  const countMutation = useMutation({`
  - `src/pages/admin/CycleCountPage.tsx:384` — `queryClient.invalidateQueries({ queryKey: PENDING_BIN_COUNTS_QUERY_KEY }), ]); };  const countMutation = useMutation({ mutationFn: submitBinCount,`
  - `src/pages/admin/ProcessChallanPage.tsx:30` — `const BARCODE_COVERAGE_QUERY_KEY = ['barcode-coverage'] as const;`
  - `src/pages/admin/ProcessChallanPage.tsx:32` — `const MAPPED_SKUS_QUERY_KEY = ['barcode-mapped-skus'] as const;`
  - `src/pages/admin/ProcessChallanPage.tsx:213` — `queryClient.invalidateQueries({ queryKey: BARCODE_COVERAGE_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: BARCODE_RACK_COVERAGE_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_QUERY_KEY }), ]`
  - `src/pages/admin/ProcessChallanPage.tsx:214` — `queryClient.invalidateQueries({ queryKey: BARCODE_RACK_COVERAGE_QUERY_KEY }), queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_QUERY_KEY }), ]); toast.success(`Saved ${ok} mapping(s). ${fail ? `${fail} failed.` : ''`
  - `src/pages/admin/ProcessChallanPage.tsx:215` — `queryClient.invalidateQueries({ queryKey: MAPPED_SKUS_QUERY_KEY }), ]); toast.success(`Saved ${ok} mapping(s). ${fail ? `${fail} failed.` : ''}`); setBulkSaving(false); }, [saveableRows, toast, queryClient, updateRow, us`
  - `src/pages/admin/UomOnboardingPage.tsx:21` — `const UOM_COVERAGE_QUERY_KEY = ['uom-coverage-gaps'] as const;`
  - `src/pages/admin/UomOnboardingPage.tsx:77` — `queryKey: UOM_COVERAGE_QUERY_KEY, queryFn: () => fetchUomCoverageGaps(800), });  const filteredCoverage = useMemo(() => { const q = coverageQuery.trim().toLowerCase();`
  - `src/pages/admin/UomOnboardingPage.tsx:228` — `void queryClient.invalidateQueries({ queryKey: PACK_DEFINITIONS_QUERY_KEY }); void queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }); void queryClient.invalidateQueries({ queryKey: UOM_COVERAGE_QUERY_KEY }); v`
  - `src/pages/admin/UomOnboardingPage.tsx:229` — `void queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY }); void queryClient.invalidateQueries({ queryKey: UOM_COVERAGE_QUERY_KEY }); void refetchCoverage(); }, onError: (e: Error) => { toast.error(e.message \|\| 'C`
  - `src/pages/admin/UomOnboardingPage.tsx:230` — `void queryClient.invalidateQueries({ queryKey: UOM_COVERAGE_QUERY_KEY }); void refetchCoverage(); }, onError: (e: Error) => { toast.error(e.message \|\| 'Could not save.'); },`
  - `src/pages/admin/receiving/ReceivingJobsPage.tsx:46` — `queryKey: RECEIVING_HUB_POS_QUERY_KEY, queryFn: fetchSentPurchaseOrdersForReceivingHub, });  const jobsQuery = useQuery({ queryKey: RECEIVING_JOBS_QUERY_KEY,`
  - `src/pages/admin/receiving/ReceivingJobsPage.tsx:93` — `await qc.invalidateQueries({ queryKey: RECEIVING_JOBS_QUERY_KEY }); await qc.invalidateQueries({ queryKey: RECEIVING_HUB_POS_QUERY_KEY }); toast.success(`Receiving ${r.job_public_id}`); navigate(`/admin/receiving/${r.rec`
  - `src/pages/admin/receiving/ReceivingJobsPage.tsx:94` — `await qc.invalidateQueries({ queryKey: RECEIVING_HUB_POS_QUERY_KEY }); toast.success(`Receiving ${r.job_public_id}`); navigate(`/admin/receiving/${r.receiving_job_id}?step=truck`); }, onError: (e: Error) => toast.error(e`
  - `src/pages/picking/PickPage.tsx:704` — `queryKey: ['pickerShelf', shelfBinId, shelfBusy], queryFn: () => fetchBinPickerShelf(shelfBinId!, shelfBusy!), enabled: Boolean(shelfBinId && shelfBusy != null), });  useEffect(() => {`
  - `src/pages/picking/PickPage.tsx:831` — `void queryClient.invalidateQueries({ queryKey: ['pickerShelf', bin, busy] }); return 'ok'; } if (res.reason === 'override_reason_required') { return 'override_blocked'; }`
  - `src/pages/picking/PickPage.tsx:1459` — `void queryClient.invalidateQueries({ queryKey: ['pickerShelf', b, busy] }); } const reasonSnap = fifoOverrideReason.trim(); setFifoOverrideSheet(null); setFifoOverrideReason(''); if (sheet.resume === 'manual') {`
- Components/files imported nowhere or only unclear by static graph:
  - `src/assets/react.svg` — DEAD
  - `src/components/receiving/ReceivingGrnTable.tsx` — UNCLEAR
  - `src/hooks/useAutoPickAssignment.ts` — UNCLEAR
  - `src/hooks/useNotificationArrivalAlerts.ts` — UNCLEAR
  - `src/lib/ocr/pickVerifier.ts` — UNCLEAR
  - `src/lib/picking/pickQueueBuckets.ts` — UNCLEAR
  - `src/lib/scanner/qrMatch.ts` — UNCLEAR
  - `src/pages/admin/receiving/ReceivingSkuCard.tsx` — UNCLEAR
  - `src/pages/billing/LiveQueue/CommitView.tsx` — UNCLEAR
  - `src/pages/billing/LiveQueue/CommunicateView.tsx` — UNCLEAR
  - `src/pages/billing/LiveQueue/CompleteView.tsx` — UNCLEAR
  - `src/pages/billing/LiveQueue/OrientView.tsx` — UNCLEAR
  - `src/pages/billing/LiveQueue/ProcessView.tsx` — UNCLEAR
  - `src/pages/billing/LiveQueue/ResolveView.tsx` — UNCLEAR
  - `src/types/qrcode.d.ts` — UNCLEAR
  - `src/workers/qrScanner.worker.ts` — UNCLEAR
- Tables queried in only one `src/` file:
  - `app_config` — `src/context/AuthContext.tsx` (select)
  - `bin_count_logs` — `src/lib/wms.ts` (select)
  - `bin_inventory_layers` — `src/lib/receiving/receivingApi.ts` (select)
  - `item_qr_tier_overrides` — `src/lib/scanner/uomMapper.ts` (upsert)
  - `license_plate_batches` — `src/lib/packLpn.ts` (update)
  - `order_events` — `src/pages/billing/LiveQueuePage.tsx` (insert)
  - `purchase_order_lines` — `src/lib/purchase/purchaseApi.ts` (insert, select, update)
  - `purchase_orders` — `src/lib/purchase/purchaseApi.ts` (insert, select, update)
  - `push_subscriptions` — `src/hooks/useRolePushNotifications.ts` (select, update, upsert)
  - `receiving_job_lines` — `src/lib/receiving/receivingApi.ts` (delete, insert, select, update)
  - `receiving_scan_events` — `src/lib/receiving/receivingApi.ts` (insert)
  - `salesperson_top_customers` — `src/lib/import/salesHistoryImporter.ts` (upsert)
  - `stock_reservations` — `src/hooks/useBillingStockFreshness.ts` (select)
  - `supplier_invoice_lines` — `src/lib/purchase/purchaseApi.ts` (insert, select, update)
  - `supplier_invoices` — `src/lib/purchase/purchaseApi.ts` (insert, select)

## SECTION 9 — SCALING RISKS

1. **Large client-side item catalog and scan index.** `src/hooks/useItems.ts:240` fetches `items` in batches and `src/stores/itemScanIndex.ts:119` fetches up to `100_000` barcode mappings; this grows with 12k+ SKUs and every barcode/UoM expansion.
2. **Order queue invalidation is broad and repeated.** Many mutations invalidate `orders`, `claimable-orders`, and per-order queries (`src/pages/billing/ReviewPage.tsx:615`, `src/pages/picking/PickPage.tsx:883`, `src/pages/sales/CartPage.tsx:1262`), increasing refetch pressure as order volume rises.
3. **Realtime fallback/polling complexity sits in hooks, not one data layer.** `src/lib/realtime.ts:75` wraps subscriptions; `src/hooks/useOrders.ts:171` and `src/hooks/useClaimableOrders.ts:496` manage queue channels separately, making volume tuning scattered.
4. **Branch model is hardcoded to two locations.** `StockLocationCode` is only `main_store | jabalpur` at `src/types/index.ts:253`, and UI branches compare `jabalpur` directly in multiple files such as `src/lib/billing/fulfillmentPath.ts:7`, `src/hooks/useClaimableOrders.ts:152`, `src/pages/sales/NewOrderPage.tsx:1430`.
5. **Custom auth/role model has weak server-side identity semantics.** Routes only require any selected role (`src/App.tsx:68`) and user identity is localStorage + name lookup (`src/context/AuthContext.tsx:172`), which becomes brittle with more staff/branches/audit trails.
6. **Billing/picking workflows are implemented in very large route files.** `src/pages/sales/NewOrderPage.tsx`, `src/pages/picking/PickPage.tsx`, `src/pages/billing/LiveQueuePage.tsx`, and `src/pages/billing/ReviewPage.tsx` each combine rendering, business rules, mutations, and flow state; this increases change risk as workflows split by branch or volume.
7. **RLS coverage is narrow and permissive where present.** Only notification/push RLS policies were found (`supabase/migrations/021_fix_notification_scoping.sql:40`, `:69`), and policies use `USING (true)` (`:52`, `:58`, `:76`, `:86`), relying on app-layer filters for scoping.
8. **One-off admin modules create many isolated query/data paths.** Receiving, purchase, pack catalog, barcode mapping, UoM, supply-demand, and labels each own local query keys and mutation flows, visible across `src/pages/admin/*` and `src/lib/*`; adding a third branch will require repeated branch-aware edits.

## SECTION 10 — SUMMARY SCORECARD

PASPL Master has a large amount of real workflow coverage: sales ordering, billing review, picking, push notifications, purchase/receiving, WMS/bin work, and admin tooling are all represented in the code. The codebase also shows organic growth: route files are large, data access is split between hooks, components, context, libraries, RPCs, realtime helpers, and edge functions, and branch/role/status strings appear throughout the UI. The app is functional and domain-rich, but the current shape makes simplification and vertical scaling risky without first consolidating data access, identity, branch modeling, and workflow boundaries.

| Dimension | Score /10 | Notes |
|---|---:|---|
| Data flow clarity | 4 | Supabase access is widespread; React Query exists but components/pages still hold many mutations and direct calls. |
| Component separation | 3 | Multiple route files exceed 1000 lines and mix render, fetch, workflow state, and business calculations. |
| Type safety | 6 | Shared domain types exist, but many local interfaces/types duplicate shapes across pages/components. |
| Auth robustness | 3 | Custom access-code/localStorage role model; no Supabase Auth session identity in frontend route guards. |
| Dead code / bloat | 5 | Core workflows are active, but lab/admin/print utility surfaces and unimported files need product-level triage. |
| Scalability readiness | 4 | Current two-branch assumptions, broad invalidations, client-side catalog loading, and large workflow files will strain at 1000 orders/day. |

---

## Appendix A — Long Source Files
- `src/pages/sales/NewOrderPage.tsx` — 2591 lines
- `src/pages/picking/PickPage.tsx` — 2223 lines
- `src/pages/admin/LabelStudioPage.tsx` — 2043 lines
- `src/pages/sales/CartPage.tsx` — 1805 lines
- `src/pages/admin/BinOnboardingPage.tsx` — 1777 lines
- `src/pages/admin/SupplyDemandPage.tsx` — 1473 lines
- `src/pages/billing/ReviewPage.tsx` — 1462 lines
- `src/pages/billing/LiveQueue/OrderSheetView.tsx` — 1433 lines
- `src/pages/admin/CycleCountPage.tsx` — 1312 lines
- `src/pages/sales/PendingRecoveryPage.tsx` — 1295 lines
- `src/pages/admin/BarcodeMappingPage.tsx` — 1291 lines
- `src/pages/sales/MyOrdersPage.tsx` — 1081 lines
- `src/pages/admin/PackCatalogPage.tsx` — 1077 lines
- `src/pages/admin/PickScanLabPage.tsx` — 994 lines
- `src/pages/billing/CompactQueuePage.tsx` — 964 lines
- `src/pages/billing/LiveQueuePage.tsx` — 963 lines
- `src/hooks/useQRScanner.ts` — 923 lines
- `src/components/shared/LiveQrScanner.tsx` — 782 lines
- `src/index.css` — 770 lines
- `src/pages/admin/receiving/ReceivingJobDetailPage.tsx` — 756 lines
- `src/hooks/useClaimableOrders.ts` — 672 lines
- `src/pages/admin/receiving/PutawayScanWizard.tsx` — 667 lines
- `src/lib/search/itemSearch.ts` — 623 lines
- `src/components/receiving/ReceivingGrnLineCard.tsx` — 602 lines
- `src/lib/import/purchasePoImporter.ts` — 594 lines
- `src/components/receiving/ReceivingGatePanel.tsx` — 580 lines
- `src/pages/picking/QueueSheet.tsx` — 568 lines
- `src/components/receiving/ReceivingSortPanel.tsx` — 558 lines
- `src/types/index.ts` — 551 lines
- `src/pages/admin/UomOnboardingPage.tsx` — 495 lines
- `src/lib/purchase/purchaseApi.ts` — 493 lines
- `src/hooks/useSalesPendingRecovery.ts` — 465 lines
- `src/lib/scanner/barcodeParser.ts` — 449 lines
- `src/pages/billing/LiveQueue/ProcessView.tsx` — 439 lines
- `src/lib/receiving/receivingApi.ts` — 436 lines
- `src/pages/billing/LiveQueue/QueueView.tsx` — 431 lines
- `src/pages/admin/receiving/ReceivingSkuCard.tsx` — 429 lines
- `src/lib/receiving/receivingPrintUtils.ts` — 423 lines
- `src/pages/admin/StockAuditLabelPrintPage.tsx` — 421 lines
- `src/pages/admin/ParetoLabelPrintPage.tsx` — 413 lines
- `src/App.tsx` — 411 lines
- `src/lib/ocr/matcher.ts` — 406 lines
- `src/components/picking/SwipeDeck.tsx` — 400 lines
- `src/lib/abbreviations.ts` — 397 lines
- `src/pages/admin/SupplyDemandSkuDetailPage.tsx` — 395 lines
- `src/components/notifications/NotificationBell.tsx` — 392 lines
- `src/pages/billing/DashboardPage.tsx` — 388 lines
- `src/pages/admin/ProcessChallanPage.tsx` — 381 lines
- `src/pages/billing/RejectedPage.tsx` — 377 lines
- `src/lib/import/salesHistoryImporter.ts` — 370 lines
- `src/pages/billing/HistoryPage.tsx` — 370 lines
- `src/pages/picking/QueuePage.tsx` — 364 lines
- `src/hooks/useItems.ts` — 363 lines
- `src/pages/purchase/PurchaseInvoiceReviewPage.tsx` — 362 lines
- `src/lib/barcodeMapping.ts` — 357 lines
- `src/pages/purchase/PurchaseInvoiceNewPage.tsx` — 356 lines
- `src/pages/sales/SalesHome.tsx` — 353 lines
- `src/pages/billing/LiveQueue/AddLineSheet.tsx` — 346 lines
- `src/pages/sales/SalesEditAddLineSheet.tsx` — 346 lines
- `src/pages/admin/UploadPage.tsx` — 340 lines
- `src/lib/scanner/qrPayload.ts` — 333 lines
- `src/lib/search/searchIndex.ts` — 325 lines
- `src/lib/packCatalog/printPackLabels.ts` — 324 lines
- `src/lib/scanner/uomMapper.ts` — 310 lines
- `src/workers/qrScanner.worker.ts` — 309 lines
- `src/lib/packCatalog/precutSheetLayout.ts` — 302 lines

## Appendix B — All `.from(...)` Call Sites
- `app_config` select at `src/context/AuthContext.tsx:137` — `.from('app_config')`
- `billing_customer_updates` select at `src/hooks/useBillingCustomerUpdate.ts:19` — `.from('billing_customer_updates')`
- `billing_customer_updates` select/insert at `src/pages/billing/LiveQueuePage.tsx:637` — `.from('billing_customer_updates')`
- `billing_customer_updates` select/insert at `src/pages/billing/ReviewPage.tsx:519` — `.from('billing_customer_updates')`
- `bin_count_logs` select at `src/lib/wms.ts:55` — `.from('bin_count_logs')`
- `bin_inventory` select at `src/lib/barcodeMapping.ts:129` — `.from('bin_inventory')`
- `bin_inventory` select at `src/lib/barcodeMapping.ts:196` — `.from('bin_inventory')`
- `bin_inventory` select at `src/lib/wms.ts:45` — `.from('bin_inventory')`
- `bin_inventory_layers` select at `src/lib/receiving/receivingApi.ts:327` — `.from('bin_inventory_layers')`
- `customer_top_items` upsert at `src/lib/import/salesHistoryImporter.ts:304` — `.from('customer_top_items')`
- `customer_top_items` select at `src/lib/ocr/matcher.ts:210` — `.from('customer_top_items')`
- `customers` select at `src/hooks/useClaimableOrders.ts:224` — `.from('customers')`
- `customers` select at `src/hooks/useCustomers.ts:9` — `.from('customers')`
- `customers` select at `src/hooks/useCustomers.ts:20` — `.from('customers')`
- `customers` select at `src/hooks/useOrderDetail.ts:110` — `.from('customers')`
- `customers` select at `src/hooks/useSalesPendingRecovery.ts:342` — `.from('customers')`
- `customers` select at `src/lib/import/customerImporter.ts:63` — `const { data: existing } = await supabase.from('customers').select('name').returns<{name: string}[]>();`
- `customers` upsert/delete at `src/lib/import/customerImporter.ts:103` — `const { error } = await supabase.from('customers').upsert(records, { onConflict: 'name' });`
- `customers` select at `src/lib/ocr/matcher.ts:199` — `.from('customers')`
- `customers` select at `src/lib/ocr/pipeline.ts:74` — `.from('customers')`
- `customers` select at `src/lib/ocr/pipeline.ts:97` — `.from('customers')`
- `customers` select at `src/lib/ocr/pipeline.ts:115` — `.from('customers')`
- `customers` select/insert at `src/pages/sales/CartPage.tsx:201` — `.from('customers')`
- `customers` insert at `src/pages/sales/NewOrderPage.tsx:537` — `.from('customers')`
- `item_barcodes` select at `src/lib/barcodeMapping.ts:318` — `.from('item_barcodes')`
- `item_barcodes` select at `src/lib/receiving/receivingApi.ts:8` — `.from('item_barcodes')`
- `item_barcodes` select at `src/stores/itemScanIndex.ts:121` — `.from('item_barcodes')`
- `item_pack_definitions` select at `src/lib/barcodeMapping.ts:302` — `.from('item_pack_definitions')`
- `item_pack_definitions` select at `src/lib/packLpn.ts:29` — `.from('item_pack_definitions')`
- `item_qr_tier_overrides` upsert at `src/lib/scanner/uomMapper.ts:274` — `const { error: tierError } = await supabase.from('item_qr_tier_overrides').upsert(`
- `items` select at `src/hooks/useItems.ts:240` — `.from('items')`
- `items` select at `src/hooks/useItems.ts:273` — `.from('items')`
- `items` select at `src/hooks/useOpenPoDemandLines.ts:277` — `.from('items')`
- `items` select at `src/hooks/useSalesPendingRecovery.ts:349` — `.from('items')`
- `items` select at `src/lib/barcodeMapping.ts:181` — `.from('items')`
- `items` select at `src/lib/barcodeMapping.ts:223` — `.from('items')`
- `items` select at `src/lib/barcodeMapping.ts:340` — `.from('items')`
- `items` select at `src/lib/import/itemImporter.ts:149` — `.from('items')`
- `items` upsert/delete at `src/lib/import/itemImporter.ts:219` — `const { error } = await supabase.from('items').upsert(changedRecords, { onConflict: 'name' });`
- `items` select at `src/lib/import/packDefinitionsImporter.ts:70` — `.from('items')`
- `items` select at `src/lib/import/purchasePoImporter.ts:212` — `.from('items')`
- `items` select at `src/lib/import/stockImporter.ts:120` — `.from('items')`
- `items` upsert/delete at `src/lib/import/stockImporter.ts:173` — `const { error } = await supabase.from('items').upsert(changedRecords, { onConflict: 'name' });`
- `items` select at `src/lib/ocr/matcher.ts:155` — `.from('items')`
- `items` select at `src/lib/ocr/matcher.ts:167` — `.from('items')`
- `items` select at `src/lib/ocr/matcher.ts:263` — `supabase.from('items').select(ITEM_SELECT).eq('is_active', true).in('alias', exactCodes),`
- `items` select at `src/lib/ocr/matcher.ts:264` — `supabase.from('items').select(ITEM_SELECT).eq('is_active', true).in('alias1', exactCodes),`
- `items` select at `src/lib/ocr/matcher.ts:326` — `.from('items')`
- `items` update at `src/lib/packCatalog/saveItemRack.ts:11` — `const { error } = await supabase.from('items').update({ rack_no: normalized }).eq('id', itemId);`
- `items` select at `src/lib/purchase/purchaseApi.ts:32` — `.from('items')`
- `license_plate_batches` update at `src/lib/packLpn.ts:58` — `.from('license_plate_batches')`
- `license_plates` update at `src/lib/packLpn.ts:65` — `.from('license_plates')`
- `license_plates` select at `src/lib/receiving/receivingApi.ts:79` — `.from('license_plates')`
- `license_plates` select at `src/lib/receiving/receivingApi.ts:116` — `.from('license_plates')`
- `notification_events` insert at `supabase/functions/send-internal-notification/index.ts:389` — `await admin.from('notification_events').insert({`
- `notification_events` insert at `supabase/functions/send-internal-notification/index.ts:506` — `await admin.from('notification_events').insert({`
- `notification_events` insert at `supabase/functions/send-internal-notification/index.ts:585` — `await admin.from('notification_events').insert({`
- `order_events` insert at `src/pages/billing/LiveQueuePage.tsx:449` — `const { error: evErr } = await supabase.from('order_events').insert({`
- `order_events` insert at `src/pages/billing/LiveQueuePage.tsx:515` — `const { error: eeErr } = await supabase.from('order_events').insert(editEvents);`
- `order_items` select at `src/hooks/useOpenPoDemandLines.ts:164` — `.from('order_items')`
- `order_items` select at `src/hooks/useOpenPoDemandLines.ts:176` — `.from('order_items')`
- `order_items` select at `src/hooks/useOpenPoDemandLines.ts:210` — `.from('order_items')`
- `order_items` select at `src/hooks/useOpenPoDemandLines.ts:217` — `.from('order_items')`
- `order_items` select at `src/hooks/useOrderDetail.ts:72` — `.from('order_items')`
- `order_items` select at `src/hooks/useSalesPendingRecovery.ts:356` — `.from('order_items')`
- `order_items` delete at `src/lib/billing/liveQueueDraft.ts:151` — `deleteIds.map((id) => supabase.from('order_items').delete().eq('id', id)),`
- `order_items` update at `src/lib/billing/liveQueueDraft.ts:176` — `supabase.from('order_items').update(patch).eq('id', id),`
- `order_items` update at `src/lib/picking/itemTransitionAdapter.ts:64` — `.from('order_items')`
- `order_items` insert/update at `src/pages/billing/CompactQueuePage.tsx:767` — `const { error: updateError } = await supabase.from('order_items').update(update).eq('id', item.id);`
- `order_items` update at `src/pages/billing/LiveQueuePage.tsx:249` — `const { error } = await supabase.from('order_items').update(patch).eq('id', orderItemId);`
- `order_items` delete at `src/pages/billing/LiveQueuePage.tsx:476` — `const { error: delErr } = await supabase.from('order_items').delete().eq('id', line.id);`
- `order_items` update at `src/pages/billing/LiveQueuePage.tsx:554` — `.from('order_items')`
- `order_items` update at `src/pages/billing/ReviewPage.tsx:383` — `.from('order_items')`
- `order_items` select/delete at `src/pages/billing/ReviewPage.tsx:409` — `await supabase.from('order_items').delete().eq('id', rid);`
- `order_items` update at `src/pages/billing/ReviewPage.tsx:491` — `.from('order_items')`
- `order_items` update at `src/pages/picking/PickPage.tsx:924` — `.from('order_items')`
- `orders` select at `src/hooks/useClaimableOrders.ts:186` — `.from('orders')`
- `orders` select at `src/hooks/useOpenPoDemandLines.ts:187` — `.from('orders')`
- `orders` select at `src/hooks/useOpenPoDemandLines.ts:199` — `.from('orders')`
- `orders` select at `src/hooks/useOrderDetail.ts:64` — `.from('orders')`
- `orders` select at `src/hooks/useOrders.ts:107` — `.from('orders')`
- `orders` select at `src/hooks/useSalesDashboard.ts:162` — `.from('orders')`
- `orders` select at `src/hooks/useSalesDashboard.ts:176` — `.from('orders')`
- `orders` select at `src/hooks/useSalesPendingRecovery.ts:336` — `.from('orders')`
- `orders` update at `src/pages/billing/CompactQueuePage.tsx:722` — `.from('orders')`
- `orders` update at `src/pages/billing/LiveQueuePage.tsx:613` — `.from('orders')`
- `orders` update at `src/pages/billing/LiveQueuePage.tsx:736` — `.from('orders')`
- `orders` update at `src/pages/billing/ReviewPage.tsx:580` — `await supabase.from('orders').update(orderUpdate).eq('id', order.id);`
- `orders` update at `src/pages/billing/ReviewPage.tsx:643` — `.from('orders')`
- `orders` update at `src/pages/billing/ReviewPage.tsx:666` — `.from('orders')`
- `orders` update at `src/pages/picking/PickPage.tsx:876` — `.from('orders')`
- `orders` select at `supabase/functions/send-internal-notification/index.ts:57` — `.from('orders')`
- `pending_items` select at `src/hooks/useOpenPoDemandLines.ts:240` — `.from('pending_items')`
- `pending_items` select at `src/hooks/useOpenPoDemandLines.ts:249` — `.from('pending_items')`
- `pending_items` select at `src/hooks/usePendingItems.ts:25` — `let q = supabase.from('pending_items').select('*').order('created_at', {`
- `pending_items` select at `src/hooks/useSalesPendingRecovery.ts:298` — `.from('pending_items')`
- `pending_items` insert at `src/pages/billing/CompactQueuePage.tsx:773` — `const { error: pendingError } = await supabase.from('pending_items').insert({`
- `pending_items` update at `src/pages/billing/LiveQueuePage.tsx:464` — `.from('pending_items')`
- `pending_items` update at `src/pages/billing/LiveQueuePage.tsx:569` — `.from('pending_items')`
- `pending_items` insert at `src/pages/billing/LiveQueuePage.tsx:602` — `const { error: pendingError } = await supabase.from('pending_items').insert(pendingRows);`
- `pending_items` select at `src/pages/billing/ReviewPage.tsx:413` — `.from('pending_items')`
- `pending_items` update at `src/pages/billing/ReviewPage.tsx:446` — `.from('pending_items')`
- `pending_items` update at `src/pages/billing/ReviewPage.tsx:472` — `.from('pending_items')`
- `pending_items` insert/update at `src/pages/billing/ReviewPage.tsx:484` — `.from('pending_items')`
- `pending_items` update at `src/pages/billing/ReviewPage.tsx:600` — `.from('pending_items')`
- `pending_items` select at `src/pages/picking/PickPage.tsx:746` — `.from('pending_items')`
- `pending_items` insert at `src/pages/picking/PickPage.tsx:755` — `await supabase.from('pending_items').insert({`
- `pending_items` update at `src/pages/sales/PendingRecoveryPage.tsx:604` — `.from('pending_items')`
- `pending_items` update at `src/pages/sales/PendingRecoveryPage.tsx:638` — `.from('pending_items')`
- `pending_items` update at `src/pages/sales/PendingRecoveryPage.tsx:651` — `.from('pending_items')`
- `pending_items` update at `src/pages/sales/PendingRecoveryPage.tsx:664` — `.from('pending_items')`
- `pending_items` update at `src/pages/sales/PendingRecoveryPage.tsx:674` — `.from('pending_items')`
- `purchase_order_lines` select at `src/lib/purchase/purchaseApi.ts:68` — `.from('purchase_order_lines')`
- `purchase_order_lines` select/insert at `src/lib/purchase/purchaseApi.ts:140` — `.from('purchase_order_lines')`
- `purchase_order_lines` insert/update at `src/lib/purchase/purchaseApi.ts:227` — `const { error: linesErr } = await supabase.from('purchase_order_lines').insert(lineRows);`
- `purchase_order_lines` update at `src/lib/purchase/purchaseApi.ts:307` — `.from('purchase_order_lines')`
- `purchase_order_lines` select at `src/lib/purchase/purchaseApi.ts:419` — `.from('purchase_order_lines')`
- `purchase_orders` select at `src/lib/purchase/purchaseApi.ts:52` — `.from('purchase_orders')`
- `purchase_orders` select at `src/lib/purchase/purchaseApi.ts:61` — `const { data, error } = await supabase.from('purchase_orders').select('*').eq('id', poId).maybeSingle();`
- `purchase_orders` insert at `src/lib/purchase/purchaseApi.ts:109` — `.from('purchase_orders')`
- `purchase_orders` insert at `src/lib/purchase/purchaseApi.ts:200` — `.from('purchase_orders')`
- `purchase_orders` update at `src/lib/purchase/purchaseApi.ts:234` — `const { error } = await supabase.from('purchase_orders').update({ status: 'sent' }).eq('id', poId);`
- `purchase_orders` update at `src/lib/purchase/purchaseApi.ts:239` — `const { error } = await supabase.from('purchase_orders').update({ notes }).eq('id', poId);`
- `purchase_orders` update at `src/lib/purchase/purchaseApi.ts:244` — `const { error } = await supabase.from('purchase_orders').update({ supplier_name }).eq('id', poId);`
- `purchase_orders` select at `src/lib/purchase/purchaseApi.ts:394` — `.from('purchase_orders')`
- `push_subscriptions` upsert at `src/hooks/useRolePushNotifications.ts:65` — `.from('push_subscriptions')`
- `push_subscriptions` update at `src/hooks/useRolePushNotifications.ts:251` — `.from('push_subscriptions')`
- `push_subscriptions` update at `src/hooks/useRolePushNotifications.ts:259` — `.from('push_subscriptions')`
- `push_subscriptions` select at `supabase/functions/send-internal-notification/index.ts:194` — `.from('push_subscriptions')`
- `push_subscriptions` update at `supabase/functions/send-internal-notification/index.ts:257` — `.from('push_subscriptions')`
- `receiving_job_lines` select at `src/lib/receiving/receivingApi.ts:95` — `.from('receiving_job_lines')`
- `receiving_job_lines` select at `src/lib/receiving/receivingApi.ts:106` — `.from('receiving_job_lines')`
- `receiving_job_lines` select/insert/delete at `src/lib/receiving/receivingApi.ts:125` — `const { data, error } = await supabase.from('receiving_job_lines').insert(row).select().single();`
- `receiving_job_lines` update/delete at `src/lib/receiving/receivingApi.ts:131` — `const { error } = await supabase.from('receiving_job_lines').delete().eq('id', lineId);`
- `receiving_job_lines` update at `src/lib/receiving/receivingApi.ts:136` — `const { error } = await supabase.from('receiving_job_lines').update(patch).eq('id', lineId);`
- `receiving_jobs` select at `src/lib/purchase/purchaseApi.ts:405` — `.from('receiving_jobs')`
- `receiving_jobs` select at `src/lib/receiving/receivingApi.ts:40` — `const { data, error } = await supabase.from('receiving_jobs').select('*').eq('id', jobId).maybeSingle();`
- `receiving_jobs` select at `src/lib/receiving/receivingApi.ts:47` — `.from('receiving_jobs')`
- `receiving_scan_events` insert at `src/lib/receiving/receivingApi.ts:275` — `const { error } = await supabase.from('receiving_scan_events').insert(row);`
- `sales_targets` select at `src/hooks/useSalesDashboard.ts:63` — `.from('sales_targets')`
- `sales_targets` select at `src/hooks/useSalesDashboard.ts:127` — `.from('sales_targets')`
- `sales_targets` insert/upsert at `src/lib/import/salesTargetsImporter.ts:249` — `.from('sales_targets')`
- `salesperson_fy_sales` select at `src/hooks/useSalesDashboard.ts:114` — `.from('salesperson_fy_sales')`
- `salesperson_fy_sales` select at `src/hooks/useSalesDashboard.ts:137` — `.from('salesperson_fy_sales')`
- `salesperson_fy_sales` upsert at `src/lib/import/salesHistoryImporter.ts:330` — `.from('salesperson_fy_sales')`
- `salesperson_product_group_sales` select at `src/hooks/useSalesDashboard.ts:76` — `.from('salesperson_product_group_sales')`
- `salesperson_product_group_sales` insert/upsert at `src/lib/import/salesHistoryImporter.ts:343` — `.from('salesperson_product_group_sales')`
- `salesperson_top_customers` upsert at `src/lib/import/salesHistoryImporter.ts:317` — `.from('salesperson_top_customers')`
- `stock_reservations` select at `src/hooks/useBillingStockFreshness.ts:59` — `.from('stock_reservations')`
- `supplier_invoice_lines` insert at `src/lib/purchase/purchaseApi.ts:185` — `const { error: invLinesErr } = await supabase.from('supplier_invoice_lines').insert(invoiceLineRows);`
- `supplier_invoice_lines` insert/update at `src/lib/purchase/purchaseApi.ts:301` — `const { error: lineErr } = await supabase.from('supplier_invoice_lines').insert(lineRows);`
- `supplier_invoice_lines` select at `src/lib/purchase/purchaseApi.ts:330` — `.from('supplier_invoice_lines')`
- `supplier_invoices` insert at `src/lib/purchase/purchaseApi.ts:151` — `.from('supplier_invoices')`
- `supplier_invoices` insert at `src/lib/purchase/purchaseApi.ts:271` — `.from('supplier_invoices')`
- `supplier_invoices` select at `src/lib/purchase/purchaseApi.ts:318` — `.from('supplier_invoices')`
- `transports` select at `src/hooks/useTransports.ts:10` — `.from('transports')`
- `transports` select at `src/lib/import/transportImporter.ts:74` — `.from('transports')`
- `transports` upsert/delete at `src/lib/import/transportImporter.ts:109` — `const { error } = await supabase.from('transports').upsert(records, { onConflict: 'name' });`
- `upload_log` insert at `src/lib/import/customerImporter.ts:126` — `await supabase.from('upload_log').insert({`
- `upload_log` insert at `src/lib/import/itemImporter.ts:243` — `await supabase.from('upload_log').insert({`
- `upload_log` insert at `src/lib/import/packDefinitionsImporter.ts:276` — `await supabase.from('upload_log').insert({`
- `upload_log` insert at `src/lib/import/salesHistoryImporter.ts:351` — `await supabase.from('upload_log').insert({`
- `upload_log` insert at `src/lib/import/salesTargetsImporter.ts:216` — `await supabase.from('upload_log').insert({`
- `upload_log` insert at `src/lib/import/salesTargetsImporter.ts:255` — `await supabase.from('upload_log').insert({`
- `upload_log` insert at `src/lib/import/salesTargetsImporter.ts:265` — `await supabase.from('upload_log').insert({`
- `upload_log` insert at `src/lib/import/stockImporter.ts:196` — `await supabase.from('upload_log').insert({`
- `upload_log` insert at `src/lib/import/transportImporter.ts:132` — `await supabase.from('upload_log').insert({`
- `user_notifications` select at `src/hooks/useUserNotifications.ts:27` — `.from('user_notifications')`
- `user_notifications` update at `src/hooks/useUserNotifications.ts:96` — `.from('user_notifications')`
- `user_notifications` update at `src/hooks/useUserNotifications.ts:115` — `.from('user_notifications')`
- `user_notifications` select at `src/lib/notificationDiagnostics.ts:140` — `const probe = await supabase.from('user_notifications').select('id').limit(1);`
- `user_notifications` select at `src/lib/notificationDiagnostics.ts:160` — `.from('user_notifications')`
- `user_notifications` insert at `supabase/functions/send-internal-notification/index.ts:184` — `const { error } = await admin.from('user_notifications').insert(rows);`
- `users` select at `src/context/AuthContext.tsx:117` — `.from('users')`
- `users` select at `src/context/AuthContext.tsx:175` — `.from('users')`
- `users` select at `src/hooks/useSalesPendingRecovery.ts:372` — `.from('users')`
- `users` select at `src/hooks/useTeamUsers.ts:14` — `.from('users')`
- `users` select at `src/hooks/useUserStockLocation.ts:32` — `.from('users')`
- `users` select at `src/hooks/useUserStockLocation.ts:46` — `.from('users')`
- `users` select at `supabase/functions/send-internal-notification/index.ts:120` — `.from('users')`
- `users` select at `supabase/functions/send-internal-notification/index.ts:139` — `.from('users')`
- `users` select at `supabase/functions/send-internal-notification/index.ts:309` — `.from('users')`
- `work_claims` select at `src/hooks/useClaimableOrders.ts:238` — `.from('work_claims')`
- `work_claims` select at `src/hooks/usePickingClaim.ts:22` — `.from('work_claims')`
- `work_claims` select at `src/pages/billing/DashboardPage.tsx:249` — `.from('work_claims')`

## Appendix C — All Route/Nav Targets Found
- `/` at `src/App.tsx:407` — `<Route path="*" element={<Navigate to="/" replace />} />`
- `/admin` at `src/pages/admin/AdminPasscodePage.tsx:32` — `navigate('/admin', { replace: true });`
- `/admin` at `src/pages/admin/AdminPasscodePage.tsx:52` — `if (adminUnlocked) return <Navigate to="/admin" replace />;`
- `/admin` at `src/pages/admin/BinOnboardingPage.tsx:883` — `onClick={() => navigate('/admin')}`
- `/admin` at `src/pages/admin/CycleCountPage.tsx:843` — `onClick={() => navigate('/admin')}`
- `/admin` at `src/pages/admin/LabelStudioPage.tsx:1034` — `onClick={() => navigate('/admin')}`
- `/admin` at `src/pages/admin/OcrOrderLabPage.tsx:220` — `<button onClick={() => navigate('/admin')} className="min-h-11 min-w-11 rounded-xl text-[var(--content-secondary)]">`
- `/admin` at `src/pages/admin/PackCatalogPage.tsx:498` — `to="/admin"`
- `/admin` at `src/pages/admin/ParetoLabelPrintPage.tsx:162` — `to="/admin"`
- `/admin` at `src/pages/admin/PickScanLabPage.tsx:383` — `onClick={() => navigate('/admin')}`
- `/admin` at `src/pages/admin/StockAuditLabelPrintPage.tsx:164` — `to="/admin"`
- `/admin` at `src/pages/admin/SupplyDemandPage.tsx:766` — `onClick={() => navigate('/admin')}`
- `/admin` at `src/pages/admin/UomOnboardingPage.tsx:246` — `onClick={() => navigate('/admin')}`
- `/admin` at `src/pages/admin/UploadPage.tsx:171` — `onClick={() => navigate('/admin')}`
- `/admin` at `src/pages/admin/receiving/ReceivingJobsPage.tsx:110` — `onClick={() => navigate('/admin')}`
- `/admin` at `src/pages/purchase/PurchaseHomePage.tsx:22` — `onClick={() => navigate('/admin')}`
- `/admin-passcode` at `src/App.tsx:77` — `if (role === 'admin' && !adminUnlocked) return <Navigate to="/admin-passcode" replace />;`
- `/admin-passcode` at `src/pages/RoleSelectPage.tsx:129` — `navigate('/admin-passcode');`
- `/admin/barcode-mapping` at `src/pages/admin/AdminPage.tsx:115` — `onClick={() => navigate('/admin/barcode-mapping')}`
- `/admin/barcode-mapping` at `src/pages/admin/ProcessChallanPage.tsx:226` — `onClick={() => navigate('/admin/barcode-mapping')}`
- `/admin/barcode-mapping/import` at `src/pages/admin/BarcodeMappingPage.tsx:576` — `onClick={() => navigate('/admin/barcode-mapping/import')}`
- `/admin/bin-onboarding` at `src/pages/admin/AdminPage.tsx:97` — `onClick={() => navigate('/admin/bin-onboarding')}`
- `/admin/cycle-count` at `src/pages/admin/AdminPage.tsx:81` — `onClick={() => navigate('/admin/cycle-count')}`
- `/admin/labels` at `src/pages/admin/AdminPage.tsx:225` — `onClick={() => navigate('/admin/labels')}`
- `/admin/ocr-lab` at `src/pages/admin/AdminPage.tsx:259` — `onClick={() => navigate('/admin/ocr-lab')}`
- `/admin/pack-catalog` at `src/pages/admin/AdminPage.tsx:177` — `onClick={() => navigate('/admin/pack-catalog')}`
- `/admin/pareto-labels` at `src/pages/admin/AdminPage.tsx:193` — `onClick={() => navigate('/admin/pareto-labels')}`
- `/admin/pick-scan-lab` at `src/pages/admin/AdminPage.tsx:243` — `onClick={() => navigate('/admin/pick-scan-lab')}`
- `/admin/pick-scan-lab?itemId=${itemId}` at `src/pages/admin/LabelStudioPage.tsx:536` — `to={`/admin/pick-scan-lab?itemId=${itemId}`}`
- `/admin/receiving` at `src/pages/admin/AdminPage.tsx:49` — `onClick={() => navigate('/admin/receiving')}`
- `/admin/receiving` at `src/pages/admin/receiving/ReceivingJobDetailPage.tsx:332` — `onClick={() => navigate('/admin/receiving')}`
- `/admin/receiving` at `src/pages/purchase/PurchaseHomePage.tsx:52` — `<BigButton type="button" variant="secondary" className="min-h-11" onClick={() => navigate('/admin/receiving')}>`
- `/admin/receiving/${job.id}?step=${step}` at `src/pages/admin/receiving/ReceivingJobsPage.tsx:167` — `navigate(`/admin/receiving/${job.id}?step=${step}`);`
- `/admin/receiving/${r.receiving_job_id}` at `src/pages/purchase/PurchaseInvoiceNewPage.tsx:125` — `navigate(`/admin/receiving/${r.receiving_job_id}`);`
- `/admin/receiving/${r.receiving_job_id}` at `src/pages/purchase/PurchaseInvoiceReviewPage.tsx:136` — `navigate(`/admin/receiving/${r.receiving_job_id}`);`
- `/admin/receiving/${r.receiving_job_id}` at `src/pages/purchase/PurchasePoDetailPage.tsx:62` — `navigate(`/admin/receiving/${r.receiving_job_id}`);`
- `/admin/receiving/${r.receiving_job_id}` at `src/pages/purchase/PurchasePoDetailPage.tsx:76` — `navigate(`/admin/receiving/${r.receiving_job_id}`);`
- `/admin/receiving/${r.receiving_job_id}?step=truck` at `src/pages/admin/receiving/ReceivingJobsPage.tsx:85` — `navigate(`/admin/receiving/${r.receiving_job_id}?step=truck`);`
- `/admin/receiving/${r.receiving_job_id}?step=truck` at `src/pages/admin/receiving/ReceivingJobsPage.tsx:96` — `navigate(`/admin/receiving/${r.receiving_job_id}?step=truck`);`
- `/admin/stock-audit-labels` at `src/pages/admin/AdminPage.tsx:209` — `onClick={() => navigate('/admin/stock-audit-labels')}`
- `/admin/supply` at `src/pages/admin/AdminPage.tsx:147` — `onClick={() => navigate('/admin/supply')}`
- `/admin/supply/sku/${itemId}?${next.toString()}` at `src/pages/admin/SupplyDemandPage.tsx:757` — `navigate(`/admin/supply/sku/${itemId}?${next.toString()}`);`
- `/admin/supply?${next.toString()}` at `src/pages/admin/SupplyDemandSkuDetailPage.tsx:243` — `navigate(`/admin/supply?${next.toString()}`);`
- `/admin/uom-onboarding` at `src/pages/admin/AdminPage.tsx:131` — `onClick={() => navigate('/admin/uom-onboarding')}`
- `/admin/upload` at `src/pages/admin/AdminPage.tsx:163` — `onClick={() => navigate('/admin/upload')}`
- `/billing` at `src/pages/RoleSelectPage.tsx:75` — `navigate('/billing');`
- `/billing` at `src/pages/billing/BillingLayout.tsx:28` — `{ icon: SquaresFour, label: 'Dashboard', path: '/billing', preload: preloadDashboard },`
- `/billing` at `src/pages/billing/BillingNewOrderLayout.tsx:36` — `navigate('/billing');`
- `/billing` at `src/pages/billing/ReviewPage.tsx:628` — `navigate('/billing');`
- `/billing` at `src/pages/billing/ReviewPage.tsx:683` — `navigate('/billing');`
- `/billing` at `src/pages/billing/ReviewPage.tsx:776` — `navigate('/billing');`
- `/billing` at `src/pages/billing/ReviewPage.tsx:784` — `onBack={() => navigate('/billing')}`
- `/billing` at `src/pages/billing/ReviewPage.tsx:808` — `onClick={() => navigate('/billing')}`
- `/billing/history` at `src/pages/billing/BillingLayout.tsx:53` — `{ icon: ClockCounterClockwise, label: 'History', path: '/billing/history', preload: preloadHistory },`
- `/billing/needs-review` at `src/pages/billing/BillingLayout.tsx:45` — `path: '/billing/needs-review',`
- `/billing/needs-review` at `src/pages/billing/DashboardPage.tsx:312` — `onClick={() => navigate('/billing/needs-review')}`
- `/billing/new-order` at `src/pages/billing/BillingLayout.tsx:38` — `path: '/billing/new-order',`
- `/billing/new-order` at `src/pages/billing/BillingNewOrderLayout.tsx:41` — `navigate('/billing/new-order', { replace: true });`
- `/billing/pending` at `src/pages/billing/BillingLayout.tsx:51` — `{ icon: HourglassHigh, label: 'Pending', path: '/billing/pending', preload: preloadPending },`
- `/billing/queue` at `src/pages/billing/BillingLayout.tsx:32` — `path: '/billing/queue',`
- `/billing/queue?orderId=${order.id}` at `src/pages/billing/DashboardPage.tsx:375` — `navigate(`/billing/queue?orderId=${order.id}`);`
- `/billing/rejected` at `src/pages/billing/BillingLayout.tsx:52` — `{ icon: Prohibit, label: 'Rejected', path: '/billing/rejected', preload: preloadRejected },`
- `/billing/review/${item.order_id}` at `src/pages/billing/PendingPage.tsx:20` — `onClick={() => navigate(`/billing/review/${item.order_id}`)}`
- `/billing/review/${order.id}` at `src/pages/billing/DashboardPage.tsx:377` — `navigate(`/billing/review/${order.id}`);`
- `/billing/review/${order.id}` at `src/pages/billing/HistoryPage.tsx:322` — `onTap={() => navigate(`/billing/review/${order.id}`)}`
- `/billing/review/${order.id}` at `src/pages/billing/NeedsReviewPage.tsx:135` — `onTap={() => navigate(`/billing/review/${order.id}`)}`
- `/billing/review/${order.id}` at `src/pages/billing/RejectedPage.tsx:293` — `onTap={() => navigate(`/billing/review/${order.id}`)}`
- `/billing/review/${order.id}` at `src/pages/billing/RejectedPage.tsx:312` — `onTap={() => navigate(`/billing/review/${order.id}`)}`
- `/billing/review/${order.id}` at `src/pages/billing/RejectedPage.tsx:329` — `onTap={() => navigate(`/billing/review/${order.id}`)}`
- `/login` at `src/App.tsx:64` — `if (!isAuthenticated) return <Navigate to="/login" replace />;`
- `/login` at `src/App.tsx:70` — `if (!isAuthenticated) return <Navigate to="/login" replace />;`
- `/login` at `src/App.tsx:83` — `if (!isAuthenticated) return <Navigate to="/login" replace />;`
- `/picking` at `src/pages/RoleSelectPage.tsx:81` — `navigate('/picking');`
- `/picking` at `src/pages/picking/PickCompleteScreen.tsx:80` — `onClick={() => navigate('/picking', { replace: true })}`
- `/picking` at `src/pages/picking/PickPage.tsx:1543` — `navigate('/picking');`
- `/picking` at `src/pages/picking/PickPage.tsx:1580` — `onClick={() => navigate('/picking')}`
- `/picking` at `src/pages/picking/PickPage.tsx:1598` — `onClick={() => navigate('/picking')}`
- `/picking` at `src/pages/picking/PickPage.tsx:1618` — `<BigButton variant="secondary" onClick={() => navigate('/picking')} className="mt-4">`
- `/picking` at `src/pages/picking/PickPage.tsx:1643` — `onClick={() => navigate('/picking')}`
- `/picking` at `src/pages/picking/PickPreviewPage.tsx:63` — `onBack={() => navigate('/picking')}`
- `/picking` at `src/pages/picking/PickPreviewPage.tsx:119` — `onClick={() => navigate('/picking')}`
- `/picking` at `src/pages/picking/PickingLayout.tsx:15` — `path: '/picking',`
- `/picking` at `src/pages/picking/PickingLayout.tsx:23` — `path: '/picking',`
- `/picking` at `src/pages/picking/QueuePage.tsx:90` — `navigate('/picking', { replace: true });`
- `/picking/barcode-mapping` at `src/pages/picking/PickingLayout.tsx:32` — `path: '/picking/barcode-mapping',`
- `/picking/barcode-mapping` at `src/pages/picking/QueuePage.tsx:309` — `onClick={() => navigate('/picking/barcode-mapping')}`
- `/picking/pick/${claimedOrderId}` at `src/pages/picking/QueuePage.tsx:113` — `navigate(`/picking/pick/${claimedOrderId}`, { replace: true });`
- `/picking/pick/${existingClaim.id}` at `src/pages/picking/QueuePage.tsx:154` — `navigate(`/picking/pick/${existingClaim.id}`, { replace: true });`
- `/picking/pick/${orderId}` at `src/pages/picking/QueuePage.tsx:274` — `onResume={(orderId) => navigate(`/picking/pick/${orderId}`)}`
- `/picking/pick/${result.order_id}` at `src/hooks/useAutoPickAssignment.ts:61` — `navigate(`/picking/pick/${result.order_id}`, { replace: true });`
- `/picking/pick/${resumePick.id}` at `src/pages/picking/QueuePage.tsx:254` — `onClick={() => navigate(`/picking/pick/${resumePick.id}`)}`
- `/purchase` at `src/components/receiving/ReceivingStepper.tsx:34` — `to="/purchase"`
- `/purchase` at `src/pages/admin/AdminPage.tsx:65` — `onClick={() => navigate('/purchase')}`
- `/purchase` at `src/pages/purchase/PurchaseInvoiceNewPage.tsx:135` — `onClick={() => navigate('/purchase')}`
- `/purchase` at `src/pages/purchase/PurchaseNewPoPage.tsx:133` — `onClick={() => navigate('/purchase')}`
- `/purchase` at `src/pages/purchase/PurchasePoDetailPage.tsx:122` — `onClick={() => navigate('/purchase')}`
- `/purchase/invoice/new` at `src/pages/purchase/PurchaseHomePage.tsx:47` — `onClick={() => navigate('/purchase/invoice/new')}`
- `/purchase/invoice/new` at `src/pages/purchase/PurchaseHomePage.tsx:73` — `onClick={() => navigate('/purchase/invoice/new')}`
- `/purchase/new` at `src/pages/purchase/PurchaseHomePage.tsx:38` — `onClick={() => navigate('/purchase/new')}`
- `/purchase/new` at `src/pages/purchase/PurchaseHomePage.tsx:65` — `<BigButton type="button" variant="secondary" className="min-h-11" onClick={() => navigate('/purchase/new')}>`
- `/purchase/po/${po.id}` at `src/pages/purchase/PurchaseHomePage.tsx:86` — `onClick={() => navigate(`/purchase/po/${po.id}`)}`
- `/purchase/po/${poId}` at `src/pages/purchase/PurchaseInvoiceReviewPage.tsx:157` — `onClick={() => navigate(`/purchase/po/${poId}`)}`
- `/purchase/po/${poId}/invoice` at `src/pages/purchase/PurchasePoDetailPage.tsx:173` — `<BigButton type="button" variant="secondary" onClick={() => navigate(`/purchase/po/${poId}/invoice`)}>`
- `/purchase/po/${r.purchase_order_id}` at `src/pages/purchase/PurchaseNewPoPage.tsx:117` — `navigate(`/purchase/po/${r.purchase_order_id}`);`
- `/purchase/po/${savedPoId}` at `src/pages/purchase/PurchaseInvoiceNewPage.tsx:339` — `onClick={() => savedPoId != null && navigate(`/purchase/po/${savedPoId}`)}`
- `/sales` at `src/pages/RoleSelectPage.tsx:69` — `navigate('/sales');`
- `/sales` at `src/pages/sales/SalesLayout.tsx:22` — `{ icon: House, label: 'Home', path: '/sales', preload: preloadSalesHome },`
- `/sales/new` at `src/pages/sales/SalesHome.tsx:293` — `<Link to="/sales/new">`
- `/sales/new` at `src/pages/sales/SalesLayout.tsx:26` — `path: '/sales/new',`
- `/sales/orders` at `src/pages/sales/SalesHome.tsx:215` — `<Link to={`/sales/orders`}>`
- `/sales/orders` at `src/pages/sales/SalesHome.tsx:301` — `<Link to="/sales/orders">`
- `/sales/orders` at `src/pages/sales/SalesLayout.tsx:33` — `path: '/sales/orders',`
- `/sales/pending-recovery` at `src/pages/sales/SalesHome.tsx:309` — `<Link to="/sales/pending-recovery">`
- `/sales/pending-recovery` at `src/pages/sales/SalesLayout.tsx:40` — `path: '/sales/pending-recovery',`
- `/select-role` at `src/App.tsx:71` — `if (!role) return <Navigate to="/select-role" replace />;`
- `/select-role` at `src/App.tsx:85` — `return <Navigate to="/select-role" replace />;`
- `/select-role` at `src/pages/LoginPage.tsx:32` — `navigate('/select-role', { replace: true });`
- `/select-role` at `src/pages/LoginPage.tsx:51` — `if (isAuthenticated) return <Navigate to="/select-role" replace />;`
- `/select-role` at `src/pages/admin/AdminPage.tsx:33` — `navigate('/select-role');`
- `/select-role` at `src/pages/admin/AdminPasscodePage.tsx:51` — `if (role !== 'admin') return <Navigate to="/select-role" replace />;`
