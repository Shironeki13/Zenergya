'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { updateContract } from '@/services/firestore';
import { CHORUS_FRAMEWORK_INFO, chorusNeedsValidator, type EInvoicingResolution } from '@/lib/einvoicing';
import { CHORUS_FRAMEWORKS, type ChorusFramework, type ChorusLegalCommitment, type Contract, type ContractChorusSettings } from '@/lib/types';

type Draft = {
    framework: ChorusFramework;
    validatorSiret: string;
    validatorServiceCode: string;
    serviceCode: string;
    marketNumber: string;
    legalCommitments: ChorusLegalCommitment[];
};

const toDraft = (s?: ContractChorusSettings): Draft => ({
    framework: s?.framework ?? 'A1',
    validatorSiret: s?.validatorSiret ?? '',
    validatorServiceCode: s?.validatorServiceCode ?? '',
    serviceCode: s?.serviceCode ?? '',
    marketNumber: s?.marketNumber ?? '',
    legalCommitments: s?.legalCommitments ?? [],
});

/** Paramètres à enregistrer : sans champ vide ni `undefined` (refusé par Firestore dans un objet imbriqué). */
export function toChorusSettings(d: Draft): ContractChorusSettings {
    const s: ContractChorusSettings = { framework: d.framework };
    if (chorusNeedsValidator(d.framework)) {
        if (d.validatorSiret.trim()) s.validatorSiret = d.validatorSiret.replace(/\s/g, '');
        if (d.validatorServiceCode.trim()) s.validatorServiceCode = d.validatorServiceCode.trim();
    }
    if (d.serviceCode.trim()) s.serviceCode = d.serviceCode.trim();
    if (d.marketNumber.trim()) s.marketNumber = d.marketNumber.trim();
    const commitments = d.legalCommitments
        .filter(c => c.number.trim() && c.startDate)
        .map(c => ({
            number: c.number.trim(),
            startDate: c.startDate,
            ...(c.endDate && { endDate: c.endDate }),
            ...(c.comment?.trim() && { comment: c.comment.trim() }),
        }))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (commitments.length) s.legalCommitments = commitments;
    return s;
}

/** Engagements dont les périodes se recouvrent : ambiguïté sur celui à déposer. */
function overlaps(commitments: ChorusLegalCommitment[]): string[] {
    const list = commitments.filter(c => c.number.trim() && c.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const issues: string[] = [];
    for (let i = 1; i < list.length; i++) {
        const prevEnd = list[i - 1].endDate;
        if (!prevEnd || prevEnd >= list[i].startDate) {
            issues.push(`Les engagements ${list[i - 1].number} et ${list[i].number} se recouvrent : le plus récent sera retenu.`);
        }
    }
    return issues;
}

/**
 * Chorus Pro au niveau du contrat : cadre de facturation, valideur (A9 / A12), code service,
 * numéro de marché et engagements juridiques par période. Prioritaires sur la fiche client.
 */
export function ContractChorusPanel({ contract, resolution, onSaved, onDraftChange }: {
    contract: Contract;
    resolution: EInvoicingResolution;
    onSaved: () => void;
    /** Pour l'aperçu de la carte : paramètres en cours de saisie. */
    onDraftChange: (settings: ContractChorusSettings) => void;
}) {
    const { toast } = useToast();
    const [draft, setDraft] = useState<Draft>(() => toDraft(contract.chorus));
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => { setDraft(toDraft(contract.chorus)); }, [contract.chorus]);
    useEffect(() => { onDraftChange(toChorusSettings(draft)); }, [draft, onDraftChange]);

    const update = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));
    const updateCommitment = (i: number, patch: Partial<ChorusLegalCommitment>) =>
        update({ legalCommitments: draft.legalCommitments.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

    const info = CHORUS_FRAMEWORK_INFO[draft.framework];
    const invalidPeriods = draft.legalCommitments.some(c => c.endDate && c.startDate && c.endDate < c.startDate);
    const incomplete = draft.legalCommitments.some(c => !c.number.trim() || !c.startDate);
    const dirty = JSON.stringify(toChorusSettings(draft)) !== JSON.stringify(toChorusSettings(toDraft(contract.chorus)));
    const chorus = resolution.chorus;

    const save = async () => {
        setIsSaving(true);
        try {
            await updateContract(contract.id, { chorus: toChorusSettings(draft) });
            toast({ title: 'Enregistré', description: 'Paramètres Chorus Pro du contrat mis à jour.' });
            onSaved();
        } catch {
            toast({ title: 'Erreur', description: 'Enregistrement impossible.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                    <Label>Cadre de facturation</Label>
                    <Select value={draft.framework} onValueChange={v => update({ framework: v as ChorusFramework })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {CHORUS_FRAMEWORKS.map(f => <SelectItem key={f} value={f}>{CHORUS_FRAMEWORK_INFO[f].label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                    <p className="text-sm text-muted-foreground">{info.description}</p>
                </div>

                {info.validator && (
                    <>
                        <div className="space-y-2">
                            <Label htmlFor="chorusValidatorSiret">SIRET du valideur ({info.validator})</Label>
                            <Input id="chorusValidatorSiret" placeholder="14 chiffres" value={draft.validatorSiret}
                                onChange={e => update({ validatorSiret: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="chorusValidatorService">Code service du valideur (si exigé)</Label>
                            <Input id="chorusValidatorService" value={draft.validatorServiceCode}
                                onChange={e => update({ validatorServiceCode: e.target.value })} />
                        </div>
                    </>
                )}

                <div className="space-y-2">
                    <Label htmlFor="chorusServiceCode">Code service du destinataire</Label>
                    <Input id="chorusServiceCode" placeholder="Vide : celui de la fiche client" value={draft.serviceCode}
                        onChange={e => update({ serviceCode: e.target.value })} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="chorusMarketNumber">Numéro de marché</Label>
                    <Input id="chorusMarketNumber" placeholder="Vide : celui de la fiche client" value={draft.marketNumber}
                        onChange={e => update({ marketNumber: e.target.value })} />
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <Label>Engagements juridiques (bons de commande), par période</Label>
                    <Button type="button" variant="outline" size="sm"
                        onClick={() => update({ legalCommitments: [...draft.legalCommitments, { number: '', startDate: '' }] })}>
                        <Plus className="mr-1 h-4 w-4" /> Ajouter
                    </Button>
                </div>
                {draft.legalCommitments.length === 0 && (
                    <p className="text-sm text-muted-foreground">Aucun : le numéro d'engagement de la fiche client est utilisé.</p>
                )}
                {draft.legalCommitments.map((c, i) => (
                    <div key={i} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_9rem_9rem_1fr_auto] items-center">
                        <Input aria-label="Numéro d'engagement" placeholder="N° d'engagement" value={c.number}
                            onChange={e => updateCommitment(i, { number: e.target.value })} />
                        <Input aria-label="Début" type="date" value={c.startDate}
                            onChange={e => updateCommitment(i, { startDate: e.target.value })} />
                        <Input aria-label="Fin (incluse)" type="date" value={c.endDate ?? ''}
                            onChange={e => updateCommitment(i, { endDate: e.target.value || undefined })} />
                        <Input aria-label="Commentaire" placeholder="Commentaire" value={c.comment ?? ''}
                            onChange={e => updateCommitment(i, { comment: e.target.value })} />
                        <Button type="button" variant="ghost" size="icon" aria-label="Supprimer l'engagement"
                            onClick={() => update({ legalCommitments: draft.legalCommitments.filter((_, j) => j !== i) })}>
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                ))}
                {invalidPeriods && <p className="text-sm text-destructive">Une fin de période précède son début.</p>}
                {incomplete && <p className="text-sm text-amber-600">Les lignes sans numéro ou sans date de début ne seront pas enregistrées.</p>}
                {overlaps(draft.legalCommitments).map(m => <p key={m} className="text-sm text-amber-600">• {m}</p>)}
            </div>

            <div className="flex justify-end">
                <Button onClick={save} disabled={!dirty || invalidPeriods || isSaving}>
                    {isSaving ? 'Enregistrement…' : 'Enregistrer'}
                </Button>
            </div>

            {chorus && (
                <div className="rounded-md border p-3 text-sm space-y-1">
                    <p className="font-medium">Dépôt d'une facture datée d'aujourd'hui</p>
                    <p>Cadre <strong>{chorus.framework}</strong> — destinataire <strong>{chorus.recipientSiret ?? '—'}</strong></p>
                    <p>Code service : <strong>{chorus.serviceCode ?? '—'}</strong>
                        {chorus.serviceCodeSource && ` (${chorus.serviceCodeSource === 'contract' ? 'contrat' : 'client'})`}</p>
                    <p>Engagement : <strong>{chorus.legalCommitment ?? '—'}</strong>
                        {chorus.legalCommitmentSource && ` (${chorus.legalCommitmentSource === 'contract' ? 'contrat' : 'client'})`}</p>
                    <p>Marché : <strong>{chorus.marketNumber ?? '—'}</strong></p>
                    {chorus.validatorSiret && <p>Valideur : <strong>{chorus.validatorSiret}</strong>{chorus.validatorServiceCode && ` — service ${chorus.validatorServiceCode}`}</p>}
                </div>
            )}
        </div>
    );
}
