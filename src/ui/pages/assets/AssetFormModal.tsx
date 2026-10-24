/**
 * Create-asset form.
 *
 * Field set and validators ported from `app/forms/asset_forms.py`
 * (`AssetForm`): institution, product name, category, currency, then the
 * optional custom name, description, notes, code/NIN, cost/charges and interest
 * rate, plus an optional initial snapshot.
 */

import { useMemo } from "react";
import { Button, Col, Form, Modal, Row } from "react-bootstrap";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { Category } from "../../../db/repositories/categories";
import type { Institution } from "../../../db/repositories/institutions";
import { createAsset } from "../../../db/repositories/assets";

const decimalInRange = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((value) => value === "" || !Number.isNaN(Number(value)), {
      message: `${label} must be a number`,
    })
    .refine((value) => value === "" || (Number(value) >= min && Number(value) <= max), {
      message: `${label} must be between ${min} and ${max}`,
    });

const schema = z.object({
  institution_id: z.string().min(1, "Please select an institution"),
  category_id: z.string().min(1, "Please select a category"),
  product_name: z
    .string()
    .trim()
    .min(1, "Please enter a product name")
    .max(100, "Product name must be between 1 and 100 characters"),
  currency: z.enum(["EUR", "USD", "CHF"]),
  name: z.string().trim().max(100, "Custom name must be at most 100 characters"),
  description: z
    .string()
    .trim()
    .max(1000, "Description must be at most 1000 characters"),
  notes: z.string().trim().max(5000, "Notes must be at most 5000 characters"),
  code_nin: z.string().trim().max(50, "Code/NIN must be at most 50 characters"),
  cost_charges: decimalInRange("Cost/charges", 0, 100),
  interest_rate: decimalInRange("Interest rate", 0, 100),
  initial_amount: z
    .string()
    .trim()
    .refine((value) => value === "" || (!Number.isNaN(Number(value)) && Number(value) > 0), {
      message: "Amount must be greater than 0",
    }),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  show: boolean;
  institutions: Institution[];
  categories: Category[];
  onHide: () => void;
  onCreated: () => void;
}

export function AssetFormModal({ show, institutions, categories, onHide, onCreated }: Props) {
  const defaults = useMemo<FormValues>(
    () => ({
      institution_id: "",
      category_id: "",
      product_name: "",
      currency: "EUR",
      name: "",
      description: "",
      notes: "",
      code_nin: "",
      cost_charges: "",
      interest_rate: "",
      initial_amount: "",
    }),
    [],
  );

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  const close = () => {
    reset(defaults);
    onHide();
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createAsset({
        institution_id: Number(values.institution_id),
        category_id: Number(values.category_id),
        currency: values.currency,
        product_name: values.product_name,
        name: values.name || null,
        description: values.description || null,
        notes: values.notes || null,
        code_nin: values.code_nin || null,
        cost_charges: values.cost_charges || null,
        interest_rate: values.interest_rate || null,
        initial_amount: values.initial_amount || null,
      });
      reset(defaults);
      onCreated();
      onHide();
    } catch (error) {
      setError("product_name", {
        message:
          error instanceof Error ? error.message : "Could not save the asset",
      });
    }
  });

  const missingReferenceData = institutions.length === 0 || categories.length === 0;

  return (
    <Modal show={show} onHide={close} size="lg" centered>
      <Form onSubmit={onSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>
            <i className="bi bi-plus-circle me-2" aria-hidden="true" />
            New asset
          </Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {missingReferenceData ? (
            <div className="alert alert-warning mb-3">
              You need at least one institution and one category first. Load the
              sample data from the assets page to get started.
            </div>
          ) : null}

          <Row className="g-3">
            <Col md={6}>
              <Form.Group controlId="institution_id">
                <Form.Label>Institution</Form.Label>
                <Form.Select
                  {...register("institution_id")}
                  isInvalid={!!errors.institution_id}
                >
                  <option value="">Select an institution…</option>
                  {institutions.map((institution) => (
                    <option key={institution.id} value={institution.id}>
                      {institution.name}
                    </option>
                  ))}
                </Form.Select>
                <Form.Control.Feedback type="invalid">
                  {errors.institution_id?.message}
                </Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group controlId="category_id">
                <Form.Label>Category</Form.Label>
                <Form.Select
                  {...register("category_id")}
                  isInvalid={!!errors.category_id}
                >
                  <option value="">Select a category…</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Form.Select>
                <Form.Control.Feedback type="invalid">
                  {errors.category_id?.message}
                </Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={8}>
              <Form.Group controlId="product_name">
                <Form.Label>Product name</Form.Label>
                <Form.Control
                  {...register("product_name")}
                  placeholder="e.g. Savings Account, Investment Portfolio"
                  isInvalid={!!errors.product_name}
                />
                <Form.Control.Feedback type="invalid">
                  {errors.product_name?.message}
                </Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={4}>
              <Form.Group controlId="currency">
                <Form.Label>Currency</Form.Label>
                <Form.Select {...register("currency")}>
                  <option value="EUR">EUR (€)</option>
                  <option value="USD">USD ($)</option>
                  <option value="CHF">CHF</option>
                </Form.Select>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group controlId="name">
                <Form.Label>Custom name</Form.Label>
                <Form.Control
                  {...register("name")}
                  placeholder="Optional, overrides the generated name"
                  isInvalid={!!errors.name}
                />
                <Form.Control.Feedback type="invalid">
                  {errors.name?.message}
                </Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={3}>
              <Form.Group controlId="cost_charges">
                <Form.Label>Cost/charges (%)</Form.Label>
                <Form.Control
                  {...register("cost_charges")}
                  placeholder="0.25"
                  isInvalid={!!errors.cost_charges}
                />
                <Form.Control.Feedback type="invalid">
                  {errors.cost_charges?.message}
                </Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={3}>
              <Form.Group controlId="interest_rate">
                <Form.Label>Interest rate (%)</Form.Label>
                <Form.Control
                  {...register("interest_rate")}
                  placeholder="1.75"
                  isInvalid={!!errors.interest_rate}
                />
                <Form.Control.Feedback type="invalid">
                  {errors.interest_rate?.message}
                </Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group controlId="code_nin">
                <Form.Label>Code/NIN</Form.Label>
                <Form.Control
                  {...register("code_nin")}
                  placeholder="Account number, IBAN, or other identifier"
                  isInvalid={!!errors.code_nin}
                />
                <Form.Control.Feedback type="invalid">
                  {errors.code_nin?.message}
                </Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group controlId="initial_amount">
                <Form.Label>Initial amount</Form.Label>
                <Form.Control
                  {...register("initial_amount")}
                  placeholder="Optional — creates a snapshot dated today"
                  isInvalid={!!errors.initial_amount}
                />
                <Form.Control.Feedback type="invalid">
                  {errors.initial_amount?.message}
                </Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col xs={12}>
              <Form.Group controlId="description">
                <Form.Label>Description</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  {...register("description")}
                  isInvalid={!!errors.description}
                />
                <Form.Control.Feedback type="invalid">
                  {errors.description?.message}
                </Form.Control.Feedback>
              </Form.Group>
            </Col>

            <Col xs={12}>
              <Form.Group controlId="notes">
                <Form.Label>Notes</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  {...register("notes")}
                  placeholder="Any additional notes, reminders, or details…"
                  isInvalid={!!errors.notes}
                />
                <Form.Control.Feedback type="invalid">
                  {errors.notes?.message}
                </Form.Control.Feedback>
              </Form.Group>
            </Col>
          </Row>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={close} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Create asset"}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
