/**
 * New / edit asset.
 *
 * One component serves both. Creation can also record a first snapshot; editing
 * cannot, and warns before the currency changes, because existing snapshots are
 * not converted.
 *
 * Writes go through `createAsset` / `updateAsset`, which run in one transaction
 * so an asset, its tags and its first snapshot land together or not at all.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Modal } from "react-bootstrap";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import {
  createAsset,
  deleteAsset,
  getAsset,
  updateAsset,
  type AssetWriteInput,
} from "../../../db/repositories/assets";
import { listCategories } from "../../../db/repositories/categories";
import { listHoldingsForAsset, type HoldingRow } from "../../../db/repositories/holdings";
import { listInstitutions } from "../../../db/repositories/institutions";
import { listSnapshotsForAsset } from "../../../db/repositories/snapshots";
import { listTagIdsForAsset, listTags } from "../../../db/repositories/tags";
import {
  assetCreateSchema,
  assetEditSchema,
  displayName,
  normaliseDecimal,
  type AssetCreateValues,
} from "../../../domain/assets";
import { todayIso } from "../../../domain/dates";
import {
  categoryHasHoldings,
  cleanHoldings,
  compositionGap,
  holdingValue,
  holdingsTotal,
  validateHoldings,
  type HoldingInput,
} from "../../../domain/holdings";
import { formatCurrency, formatDate, formatMinorAsCurrency, relativeDate } from "../../../domain/format";
import { fromMinorUnits } from "../../../domain/money";
import { AssetDeleteModal } from "../../components/AssetDeleteModal";
import { PageHeader } from "../../components/FormCard";
import {
  QuickAddCategoryModal,
  QuickAddInstitutionModal,
  QuickAddTagModal,
} from "../../components/QuickAddModal";
import { useToast } from "../../layout/Toasts";

function FieldError({ message }: { message?: string }) {
  return message ? <div className="invalid-feedback d-block">{message}</div> : null;
}

export function AssetFormPage() {
  const { assetId } = useParams();
  const editingId = assetId ? Number(assetId) : null;

  const assetQuery = useQuery({
    queryKey: ["asset", editingId],
    queryFn: () => getAsset(editingId as number),
    enabled: editingId !== null,
  });
  const tagIdsQuery = useQuery({
    queryKey: ["asset-tags", editingId],
    queryFn: () => listTagIdsForAsset(editingId as number),
    enabled: editingId !== null,
  });
  const holdingsQuery = useQuery({
    queryKey: ["asset-holdings", editingId],
    queryFn: () => listHoldingsForAsset(editingId as number),
    enabled: editingId !== null,
  });

  if (editingId !== null) {
    if (assetQuery.isLoading || tagIdsQuery.isLoading || holdingsQuery.isLoading) {
      return <p className="text-muted">Loading…</p>;
    }
    if (!assetQuery.data) {
      return (
        <div className="alert alert-warning">
          <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />
          The requested asset was not found. <Link to="/assets">Back to Assets</Link>
        </div>
      );
    }
    return (
      <AssetForm
        key={editingId}
        editing={{
          asset: assetQuery.data,
          tagIds: tagIdsQuery.data ?? [],
          holdings: holdingsQuery.data ?? [],
        }}
      />
    );
  }

  return <AssetForm />;
}

interface EditingState {
  asset: NonNullable<Awaited<ReturnType<typeof getAsset>>>;
  tagIds: number[];
  holdings: HoldingRow[];
}

function AssetForm({ editing }: { editing?: EditingState }) {
  const isEdit = editing !== undefined;
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const institutions = useQuery({ queryKey: ["institutions"], queryFn: listInstitutions });
  const categories = useQuery({ queryKey: ["categories"], queryFn: listCategories });
  const tags = useQuery({ queryKey: ["tags"], queryFn: listTags });
  const snapshots = useQuery({
    queryKey: ["snapshots", editing?.asset.id],
    queryFn: () => listSnapshotsForAsset(editing!.asset.id),
    enabled: isEdit,
  });

  const referenceLoading =
    institutions.isLoading || categories.isLoading || tags.isLoading || (isEdit && snapshots.isLoading);

  const [quickAdd, setQuickAdd] = useState<"institution" | "category" | "tag" | null>(null);
  const [currencyConfirm, setCurrencyConfirm] = useState<AssetCreateValues | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [holdings, setHoldings] = useState<HoldingInput[]>(
    () =>
      editing?.holdings.map((row) => ({
        isin: row.isin,
        label: row.label ?? "",
        quantity: row.quantity,
        price: row.price ?? "",
      })) ?? [],
  );
  const [holdingErrors, setHoldingErrors] = useState<
    Record<number, { isin?: string; label?: string; quantity?: string; price?: string }>
  >({});

  const defaults = useMemo<AssetCreateValues>(
    () => ({
      institution_id: editing ? String(editing.asset.institution_id) : "",
      category_id: editing ? String(editing.asset.category_id) : "",
      product_name: editing?.asset.product_name ?? "",
      currency: (editing?.asset.currency as AssetCreateValues["currency"]) ?? "EUR",
      name: editing?.asset.name ?? "",
      description: editing?.asset.description ?? "",
      notes: editing?.asset.notes ?? "",
      code_nin: editing?.asset.code_nin ?? "",
      cost_charges: editing?.asset.cost_charges ?? "",
      interest_rate: editing?.asset.interest_rate ?? "",
      tags: editing ? editing.tagIds.map(String) : [],
      create_initial_snapshot: true,
      initial_amount: "",
      initial_date: todayIso(),
    }),
    [editing],
  );

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AssetCreateValues>({
    resolver: zodResolver(isEdit ? assetEditSchema : assetCreateSchema) as unknown as Resolver<AssetCreateValues>,
    defaultValues: defaults,
  });

  const selectedTags = watch("tags");
  const createSnapshot = watch("create_initial_snapshot");
  const selectedCategoryId = watch("category_id");

  // The section exists only for categories whose role says "made of
  // instruments". Every category has a role now, so there is no fallback.
  const selectedRole = categories.data?.find((row) => String(row.id) === selectedCategoryId)?.system_role ?? null;
  const showHoldings = categoryHasHoldings(selectedRole);

  // Switching to a category that cannot hold instruments drops the rows, and
  // says so: silently losing them on save would be the worse outcome.
  useEffect(() => {
    if (!showHoldings) {
      setHoldings((current) => {
        if (current.length === 0) return current;
        toast.warning("Holdings cleared: this category's role does not hold instruments.");
        return [];
      });
      setHoldingErrors({});
    }
    // `toast` is stable; the trigger is the role, not the rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHoldings]);

  const refreshReference = (key: "institutions" | "categories" | "tags") =>
    queryClient.invalidateQueries({ queryKey: [key] });

  const toInput = (values: AssetCreateValues): AssetWriteInput => ({
    institution_id: Number(values.institution_id),
    category_id: Number(values.category_id),
    currency: values.currency,
    product_name: values.product_name,
    name: values.name || null,
    description: values.description || null,
    notes: values.notes || null,
    code_nin: values.code_nin || null,
    cost_charges: normaliseDecimal(values.cost_charges),
    interest_rate: normaliseDecimal(values.interest_rate),
    tag_ids: values.tags.map(Number),
    holdings: showHoldings ? cleanHoldings(holdings) : [],
  });

  const labelFor = (values: AssetCreateValues): string =>
    displayName({
      name: values.name || null,
      institution_name:
        institutions.data?.find((row) => String(row.id) === values.institution_id)?.name ?? "Unknown",
      product_name: values.product_name,
      category_name:
        categories.data?.find((row) => String(row.id) === values.category_id)?.name ?? "Unknown",
    });

  const invalidateAssets = () => {
    for (const key of ["assets", "asset", "asset-tags", "snapshots", "snapshot-points"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  const save = async (values: AssetCreateValues) => {
    try {
      if (isEdit) {
        await updateAsset(editing.asset.id, toInput(values));
        invalidateAssets();
        toast.success(`Asset "${labelFor(values)}" updated successfully!`);
        navigate(`/assets/${editing.asset.id}`);
        return;
      }

      const wantsSnapshot = values.create_initial_snapshot && values.initial_amount !== "";
      const id = await createAsset({
        ...toInput(values),
        initial_amount: wantsSnapshot ? values.initial_amount : null,
        initial_date: wantsSnapshot ? values.initial_date || todayIso() : null,
      });
      invalidateAssets();

      let message = `Asset "${labelFor(values)}" created successfully!`;
      if (wantsSnapshot) {
        message += ` Initial snapshot of ${values.initial_amount} ${values.currency} was also created.`;
      }
      toast.success(message);
      navigate(`/assets/${id}`);
    } catch (error) {
      toast.error(
        `Error ${isEdit ? "updating" : "creating"} asset: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    // Holdings are outside the form schema (they are a list, not a field), so
    // they are validated here, before anything is written.
    const problems = showHoldings ? validateHoldings(holdings) : {};
    setHoldingErrors(problems);
    if (Object.keys(problems).length > 0) {
      toast.error("Check the holdings: an ISIN or a quantity is not valid.");
      return;
    }

    // Changing the currency does not convert existing snapshots: ask first.
    if (isEdit && values.currency !== editing.asset.currency) {
      setCurrencyConfirm(values);
      return;
    }
    await save(values);
  });

  const holdingsCurrency = watch("currency");
  const holdingsTotalValue = holdingsTotal(holdings);
  const latestSnapshotValue = useMemo(() => {
    const points = snapshots.data ?? [];
    if (points.length === 0) return null;
    const latest = [...points].sort((a, b) => b.date.localeCompare(a.date))[0];
    return fromMinorUnits(latest.amount_minor);
  }, [snapshots.data]);
  const gap = compositionGap(holdings, latestSnapshotValue);

  const addHolding = () => {
    setHoldings((current) => [...current, { isin: "", label: "", quantity: "", price: "" }]);
  };

  const removeHolding = (index: number) => {
    setHoldings((current) => current.filter((_, position) => position !== index));
    setHoldingErrors({});
  };

  const changeHolding = (index: number, field: keyof HoldingInput, value: string) => {
    setHoldings((current) =>
      current.map((row, position) => (position === index ? { ...row, [field]: value } : row)),
    );
    // The message belongs to what was typed before the fix, not after it.
    setHoldingErrors((current) => {
      if (!current[index]) return current;
      const next = { ...current };
      delete next[index];
      return next;
    });
  };

  const toggleTag = (id: string) =>
    setValue(
      "tags",
      selectedTags.includes(id) ? selectedTags.filter((value) => value !== id) : [...selectedTags, id],
      { shouldDirty: true },
    );

  const latest = snapshots.data?.length
    ? [...snapshots.data].sort((a, b) => b.date.localeCompare(a.date))[0]
    : null;

  const removeAsset = async () => {
    if (!editing) return;
    try {
      await deleteAsset(editing.asset.id);
      invalidateAssets();
      toast.success(`Asset "${displayName({
        name: editing.asset.name,
        institution_name: institutions.data?.find((r) => r.id === editing.asset.institution_id)?.name ?? "Unknown",
        product_name: editing.asset.product_name,
        category_name: categories.data?.find((r) => r.id === editing.asset.category_id)?.name ?? "Unknown",
      })}" deleted successfully!`);
      navigate("/assets");
    } catch (error) {
      toast.error(`Error deleting asset: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setConfirmDelete(false);
    }
  };

  const title = isEdit ? labelFor(defaults) : "Add New Asset";

  if (referenceLoading) return <p className="text-muted">Loading…</p>;

  return (
    <>
      <PageHeader
        title={title}
        subtitle={isEdit ? "Edit asset information and settings" : "Create a new financial asset to track"}
        icon={isEdit ? "pencil" : undefined}
        showDate={false}
        actions={
          <>
            <Link to="/assets" className={isEdit ? "btn btn-secondary btn-sm" : "btn btn-outline-secondary"}>
              <i className="bi bi-arrow-left me-2" aria-hidden="true" />
              Back to Assets
            </Link>
            {isEdit ? (
              <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => setConfirmDelete(true)}>
                <i className="bi bi-trash" aria-hidden="true" />
                Delete
              </button>
            ) : null}
          </>
        }
      />

      <form onSubmit={onSubmit} id={isEdit ? "assetEditForm" : "assetForm"} noValidate>
        <div className="row">
          <div className="col-lg-8">
            <div className="form-section">
              <h5><i className="bi bi-info-circle me-2" aria-hidden="true" />Basic Information</h5>

              <div className="row">
                <div className="col-md-6 mb-3">
                  <label htmlFor="institution_id" className="form-label required-field">Institution</label>
                  <div className="input-group">
                    <select id="institution_id" className="form-select" {...register("institution_id")}>
                      <option value="">Select an institution...</option>
                      {(institutions.data ?? []).map((row) => (
                        <option key={row.id} value={row.id}>{row.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      title="Add new institution"
                      aria-label="Add new institution"
                      onClick={() => setQuickAdd("institution")}
                    >
                      <i className="bi bi-plus-lg" aria-hidden="true" />
                    </button>
                  </div>
                  <FieldError message={errors.institution_id?.message} />
                  <div className="field-help">Choose the financial institution that holds this asset</div>
                </div>

                <div className="col-md-6 mb-3">
                  <label htmlFor="product_name" className="form-label required-field">Product Name</label>
                  <input
                    id="product_name"
                    className={`form-control${errors.product_name ? " is-invalid" : ""}`}
                    placeholder="e.g., High-yield savings account, Checking account"
                    {...register("product_name")}
                  />
                  <FieldError message={errors.product_name?.message} />
                  <div className="field-help">The specific product or account type</div>
                </div>
              </div>

              <div className="row">
                <div className="col-md-6 mb-3">
                  <label htmlFor="category_id" className="form-label required-field">Category</label>
                  <div className="input-group">
                    <select id="category_id" className="form-select" {...register("category_id")}>
                      <option value="">Select a category...</option>
                      {(categories.data ?? []).map((row) => (
                        <option key={row.id} value={row.id}>{row.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      title="Add new category"
                      aria-label="Add new category"
                      onClick={() => setQuickAdd("category")}
                    >
                      <i className="bi bi-plus-lg" aria-hidden="true" />
                    </button>
                  </div>
                  <FieldError message={errors.category_id?.message} />
                  <div className="field-help">Asset category for organization and reporting</div>
                </div>

                <div className="col-md-6 mb-3">
                  <label htmlFor="currency" className="form-label required-field">Currency</label>
                  <select id="currency" className="form-select" {...register("currency")}>
                    <option value="EUR">EUR (€)</option>
                    <option value="USD">USD ($)</option>
                    <option value="CHF">CHF</option>
                  </select>
                  <FieldError message={errors.currency?.message} />
                  <div className="field-help">Primary currency for this asset</div>
                </div>
              </div>

              <div className="mb-3">
                <label htmlFor="name" className="form-label">Custom Name</label>
                <input
                  id="name"
                  className={`form-control${errors.name ? " is-invalid" : ""}`}
                  placeholder="e.g., My main savings account, Emergency fund, etc."
                  {...register("name")}
                />
                <FieldError message={errors.name?.message} />
                <div className="field-help">Give this asset a custom name (e.g., 'My main savings account')</div>
              </div>

              <div className="mb-3">
                <label htmlFor="description" className="form-label">Description</label>
                <textarea
                  id="description"
                  rows={3}
                  className={`form-control${errors.description ? " is-invalid" : ""}`}
                  placeholder="Additional information about this asset..."
                  {...register("description")}
                />
                <FieldError message={errors.description?.message} />
                <div className="field-help">Additional information about this asset</div>
              </div>

              <div className="mb-3">
                <label htmlFor="notes" className="form-label">Notes</label>
                <textarea
                  id="notes"
                  rows={4}
                  className={`form-control${errors.notes ? " is-invalid" : ""}`}
                  placeholder="Any additional notes, reminders, or details..."
                  {...register("notes")}
                />
                <FieldError message={errors.notes?.message} />
                <div className="field-help">Free-form notes and details about this asset</div>
              </div>
            </div>

            {showHoldings ? (
              <div className="form-section">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h5 className="mb-0">
                    <i className="bi bi-pie-chart me-2" aria-hidden="true" />
                    Holdings
                  </h5>
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={addHolding}>
                    <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                    Add a holding
                  </button>
                </div>

                {holdings.length === 0 ? (
                  <p className="text-muted mb-0">
                    No holdings recorded. List what this asset is made of: one ISIN and a quantity per
                    line. The snapshot stays the value — holdings describe the composition.
                  </p>
                ) : (
                  <table className="table align-middle mb-0">
                    <thead>
                      <tr>
                        <th scope="col" style={{ width: "26%" }}>Name</th>
                        <th scope="col" style={{ width: "24%" }}>ISIN</th>
                        <th scope="col" style={{ width: "12%" }}>Quantity</th>
                        <th scope="col" style={{ width: "14%" }}>Price</th>
                        <th scope="col" className="text-end" style={{ width: "16%" }}>Value</th>
                        <th scope="col" className="text-end">
                          <span className="visually-hidden">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {holdings.map((row, index) => (
                        <tr key={index}>
                          <td>
                            <input
                              className={`form-control${holdingErrors[index]?.label ? " is-invalid" : ""}`}
                              value={row.label}
                              aria-label={`Name, line ${index + 1}`}
                              placeholder="iShares MSCI World"
                              autoComplete="off"
                              onChange={(event) => changeHolding(index, "label", event.target.value)}
                            />
                            {holdingErrors[index]?.label ? (
                              <div className="invalid-feedback d-block">{holdingErrors[index].label}</div>
                            ) : null}
                          </td>
                          <td>
                            <input
                              className={`form-control${holdingErrors[index]?.isin ? " is-invalid" : ""}`}
                              value={row.isin}
                              aria-label={`ISIN, line ${index + 1}`}
                              placeholder="FR0000120073"
                              autoCapitalize="characters"
                              autoComplete="off"
                              spellCheck={false}
                              onChange={(event) => changeHolding(index, "isin", event.target.value)}
                            />
                            {holdingErrors[index]?.isin ? (
                              <div className="invalid-feedback d-block">{holdingErrors[index].isin}</div>
                            ) : null}
                          </td>
                          <td>
                            <input
                              className={`form-control${holdingErrors[index]?.quantity ? " is-invalid" : ""}`}
                              value={row.quantity}
                              aria-label={`Quantity, line ${index + 1}`}
                              placeholder="12.5"
                              inputMode="decimal"
                              autoComplete="off"
                              onChange={(event) => changeHolding(index, "quantity", event.target.value)}
                            />
                            {holdingErrors[index]?.quantity ? (
                              <div className="invalid-feedback d-block">{holdingErrors[index].quantity}</div>
                            ) : null}
                          </td>
                          <td>
                            <input
                              className={`form-control${holdingErrors[index]?.price ? " is-invalid" : ""}`}
                              value={row.price}
                              aria-label={`Price, line ${index + 1}`}
                              placeholder="45.20"
                              inputMode="decimal"
                              autoComplete="off"
                              onChange={(event) => changeHolding(index, "price", event.target.value)}
                            />
                            {holdingErrors[index]?.price ? (
                              <div className="invalid-feedback d-block">{holdingErrors[index].price}</div>
                            ) : null}
                          </td>
                          <td className="text-end money">
                            {holdingValue(row)?.toFixed(2) ?? <span className="text-muted">—</span>}
                          </td>
                          <td className="text-end">
                            <button
                              type="button"
                              className="btn btn-outline-danger btn-sm"
                              aria-label={`Remove line ${index + 1}`}
                              onClick={() => removeHolding(index)}
                            >
                              <i className="bi bi-x-lg" aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4} className="text-end fw-semibold">
                          Total
                        </td>
                        <td className="text-end money fw-semibold">
                          {holdingsTotalValue
                            ? formatCurrency(holdingsTotalValue.total.toNumber(), holdingsCurrency)
                            : "—"}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                )}

                {holdingsTotalValue && !holdingsTotalValue.allPriced ? (
                  <div className="field-help mt-2">
                    {holdingsTotalValue.rows - holdingsTotalValue.priced} line
                    {holdingsTotalValue.rows - holdingsTotalValue.priced === 1 ? " has" : "s have"} no
                    price, so the total covers the rest.
                  </div>
                ) : null}

                {gap && gap.greaterThan(0.01) ? (
                  <div className="field-help mt-1 text-warning">
                    The lines add up to {formatCurrency(holdingsTotalValue!.total.toNumber(), holdingsCurrency)},
                    and the latest snapshot says{" "}
                    {latestSnapshotValue ? formatCurrency(latestSnapshotValue.toNumber(), holdingsCurrency) : "—"}.
                    Update the prices or the snapshot, or leave it if fees or cash explain the
                    difference.
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="form-section">
              <h5><i className="bi bi-gear me-2" aria-hidden="true" />Technical Details</h5>

              <div className="row">
                <div className="col-md-6 mb-3">
                  <label htmlFor="code_nin" className="form-label">Code/NIN</label>
                  <input
                    id="code_nin"
                    className={`form-control${errors.code_nin ? " is-invalid" : ""}`}
                    placeholder="Account number or identification code"
                    {...register("code_nin")}
                  />
                  <FieldError message={errors.code_nin?.message} />
                  <div className="field-help">Account number, IBAN, or other identification code</div>
                </div>
                <div className="col-md-6 mb-3">
                  <label htmlFor="interest_rate" className="form-label">Interest Rate (%)</label>
                  <input
                    id="interest_rate"
                    type="number"
                    step="0.01"
                    min="0"
                    className={`form-control${errors.interest_rate ? " is-invalid" : ""}`}
                    placeholder="0.00"
                    {...register("interest_rate")}
                  />
                  <FieldError message={errors.interest_rate?.message} />
                  <div className="field-help">Annual interest rate as percentage</div>
                </div>
              </div>

              <div className="row">
                <div className="col-md-6 mb-3">
                  <label htmlFor="cost_charges" className="form-label">Cost/Charges (%)</label>
                  <div className="input-group">
                    <input
                      id="cost_charges"
                      type="number"
                      step="0.01"
                      min="0"
                      className={`form-control${errors.cost_charges ? " is-invalid" : ""}`}
                      placeholder="0.00"
                      {...register("cost_charges")}
                    />
                    <span className="input-group-text" id="cost-currency">%</span>
                  </div>
                  <FieldError message={errors.cost_charges?.message} />
                  <div className="field-help">Annual cost or charges as percentage</div>
                </div>

                <div className="col-md-6 mb-3">
                  <div className="d-flex justify-content-between align-items-center">
                    <label className="form-label mb-0">Tags</label>
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0"
                      onClick={() => setQuickAdd("tag")}
                    >
                      <i className="bi bi-plus-lg" aria-hidden="true" /> New tag
                    </button>
                  </div>
                  <div className="check-list">
                    {(tags.data ?? []).length > 0 ? (
                      (tags.data ?? []).map((tag) => (
                        <div className="form-check" key={tag.id}>
                          <input
                            id={`tag-${tag.id}`}
                            type="checkbox"
                            className="form-check-input"
                            checked={selectedTags.includes(String(tag.id))}
                            onChange={() => toggleTag(String(tag.id))}
                          />
                          <label className="form-check-label" htmlFor={`tag-${tag.id}`}>{tag.name}</label>
                        </div>
                      ))
                    ) : (
                      <span className="check-list-empty">No tags defined yet.</span>
                    )}
                  </div>
                  <div className="field-help">Select applicable tags for this asset</div>
                </div>
              </div>
            </div>

            {!isEdit ? (
              <div className="form-section">
                <h5><i className="bi bi-camera me-2" aria-hidden="true" />Initial Snapshot (Optional)</h5>
                <p className="text-muted small">
                  Optionally create an initial snapshot to record the starting value of this asset.
                </p>

                <div className="mb-3">
                  <div className="form-check">
                    <input
                      id="create_initial_snapshot"
                      type="checkbox"
                      className="form-check-input"
                      {...register("create_initial_snapshot")}
                    />
                    <label className="form-check-label" htmlFor="create_initial_snapshot">
                      Create Initial Snapshot
                    </label>
                  </div>
                  <div className="field-help">Create an initial snapshot with the asset's starting value</div>
                </div>

                <div className="row">
                  <div className="col-md-6 mb-3">
                    <label htmlFor="initial_amount" className="form-label">Initial Amount</label>
                    <input
                      id="initial_amount"
                      type="number"
                      step="0.01"
                      disabled={!createSnapshot}
                      className={`form-control${errors.initial_amount ? " is-invalid" : ""}`}
                      {...register("initial_amount")}
                    />
                    <FieldError message={errors.initial_amount?.message} />
                    <div className="field-help">Starting value of this asset</div>
                  </div>
                  <div className="col-md-6 mb-3">
                    <label htmlFor="initial_date" className="form-label">Initial Date</label>
                    <input
                      id="initial_date"
                      type="date"
                      disabled={!createSnapshot}
                      className={`form-control${errors.initial_date ? " is-invalid" : ""}`}
                      {...register("initial_date")}
                    />
                    <FieldError message={errors.initial_date?.message} />
                    <div className="field-help">Date of the initial snapshot (defaults to today)</div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="col-lg-4">
            {isEdit ? (
              <>
                <div className="card form-actions-card">
                  <div className="card-body d-grid gap-2">
                    <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                      <i className="bi bi-check-lg" aria-hidden="true" />
                      Update Asset
                    </button>
                    <Link to={`/assets/${editing.asset.id}`} className="btn btn-secondary">Cancel</Link>
                  </div>
                </div>

                <div className="card">
                  <div className="card-header">
                    <h6 className="card-title mb-0">
                      <i className="bi bi-graph-up" aria-hidden="true" />
                      Current Values
                    </h6>
                  </div>
                  <div className="card-body">
                    <dl className="detail-list mb-0">
                      <div className="detail-row">
                        <dt>Snapshots</dt>
                        <dd>{snapshots.data?.length ?? 0}</dd>
                      </div>
                      {latest ? (
                        <>
                          <div className="detail-row">
                            <dt>Latest value</dt>
                            <dd className="money">{formatMinorAsCurrency(latest.amount_minor, editing.asset.currency)}</dd>
                          </div>
                          <div className="detail-row">
                            <dt>Last updated</dt>
                            <dd className="text-muted">{relativeDate(latest.date)}</dd>
                          </div>
                        </>
                      ) : null}
                      <div className="detail-row">
                        <dt>Created</dt>
                        <dd className="text-muted">{formatDate(editing.asset.created_at.slice(0, 10))}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <div className="callout callout-warning">
                  <div className="callout-title">
                    <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />
                    Before you save
                  </div>
                  <ul className="callout-list mb-0">
                    <li>Changing the currency does not convert existing snapshot values.</li>
                    <li>Changing the institution or product may affect historical reporting.</li>
                  </ul>
                </div>
              </>
            ) : (
              <>
                <div className="card mb-4">
                  <div className="card-header">
                    <h6 className="card-title mb-0">
                      <i className="bi bi-question-circle me-2" aria-hidden="true" />
                      Need Help?
                    </h6>
                  </div>
                  <div className="card-body">
                    <small className="text-muted">
                      <strong>Institution:</strong> The bank or financial company that holds your asset.<br /><br />
                      <strong>Product:</strong> The specific account or investment product type.<br /><br />
                      <strong>Category:</strong> General classification like "Savings", "Investment", etc.<br /><br />
                      <strong>Currency:</strong> The primary currency in which this asset is denominated.<br /><br />
                      <strong>Initial Snapshot:</strong> Optionally record the starting value of your asset to begin tracking its value immediately.
                    </small>
                  </div>
                </div>

                <div className="card">
                  <div className="card-body">
                    <button type="submit" className="btn btn-primary w-100 mb-2" disabled={isSubmitting}>
                      <i className="bi bi-save me-2" aria-hidden="true" />
                      Create Asset
                    </button>
                    <Link to="/assets" className="btn btn-outline-secondary w-100">
                      <i className="bi bi-x me-2" aria-hidden="true" />
                      Cancel
                    </Link>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </form>

      <QuickAddInstitutionModal
        show={quickAdd === "institution"}
        onClose={() => setQuickAdd(null)}
        onCreated={async (created) => {
          await refreshReference("institutions");
          setValue("institution_id", String(created.id), { shouldValidate: true });
        }}
      />
      <QuickAddCategoryModal
        show={quickAdd === "category"}
        onClose={() => setQuickAdd(null)}
        onCreated={async (created) => {
          await refreshReference("categories");
          setValue("category_id", String(created.id), { shouldValidate: true });
        }}
      />
      <QuickAddTagModal
        show={quickAdd === "tag"}
        onClose={() => setQuickAdd(null)}
        onCreated={async (created) => {
          await refreshReference("tags");
          setValue("tags", [...selectedTags, String(created.id)], { shouldDirty: true });
        }}
      />

      <Modal show={currencyConfirm !== null} onHide={() => setCurrencyConfirm(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Change currency?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          You are changing the currency from <strong>{editing?.asset.currency}</strong> to{" "}
          <strong>{currencyConfirm?.currency}</strong>. This will not convert existing snapshot
          values. Are you sure you want to continue?
        </Modal.Body>
        <Modal.Footer>
          <button type="button" className="btn btn-secondary" onClick={() => setCurrencyConfirm(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={async () => {
              const values = currencyConfirm;
              setCurrencyConfirm(null);
              if (values) await save(values);
            }}
          >
            Change currency
          </button>
        </Modal.Footer>
      </Modal>

      <AssetDeleteModal
        name={confirmDelete ? title : null}
        snapshotCount={snapshots.data?.length}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={removeAsset}
      />
    </>
  );
}
