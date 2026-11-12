import assert from "node:assert/strict";
import test from "node:test";
import {
  createPatientAppointmentApi,
  mapEhrAppointment,
  mapEhrSlot,
  PatientAppointmentApiError,
} from "../frontend/src/ehrAppointmentApi.mjs";

const slotDto = {
  slotId: "slot-1",
  departmentCode: "CARD",
  departmentName: "心血管内科",
  doctorCode: "D-1",
  doctorName: "李医生",
  slotDate: "2026-11-04",
  period: "AM",
  remainingSeats: 2,
  status: "OPEN",
  capacity: 10,
  booked: 8,
  createdBy: "staff-1",
};

const appointmentDto = {
  appointmentNo: "OPD-1",
  slotId: "slot-1",
  departmentCode: "CARD",
  departmentName: "心血管内科",
  doctorCode: "D-1",
  doctorName: "李医生",
  slotDate: "2026-11-04",
  period: "AM",
  status: "REGISTERED",
  registeredAt: "2026-11-03T08:00:00Z",
  patientId: "patient-private",
  patientName: "患者姓名",
  registeredBy: "staff-private",
};

test("EHR schedule DTO maps to the app-owned slot format without staff/count details", () => {
  const slot = mapEhrSlot(slotDto);

  assert.deepEqual(slot, {
    id: "slot-1",
    department: { code: "CARD", name: "心血管内科" },
    clinician: { code: "D-1", name: "李医生" },
    visitDate: "2026-11-04",
    period: "AM",
    remaining: 2,
    state: "available",
  });
  assert.equal("capacity" in slot, false);
  assert.equal("createdBy" in slot, false);
});

test("EHR registration DTO maps status and omits patient and operator identifiers", () => {
  const appointment = mapEhrAppointment(appointmentDto);

  assert.equal(appointment.id, "OPD-1");
  assert.equal(appointment.status, "booked");
  assert.equal("patientId" in appointment, false);
  assert.equal("patientName" in appointment, false);
  assert.equal("registeredBy" in appointment, false);
});

test("slot lookup calls the patient application endpoint with a bounded date window", async () => {
  let request;
  const api = createPatientAppointmentApi({
    baseUrl: "https://ehr.example",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({ code: "OK", data: [slotDto] });
    },
  });

  const slots = await api.slots({
    fromDate: "2026-11-04",
    toDate: "2026-11-10",
  });
  assert.equal(
    request.url,
    "https://ehr.example/api/v1/patient/appointment-slots?fromDate=2026-11-04&toDate=2026-11-10",
  );
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(slots[0].id, "slot-1");
});

test("booking sends only the slot and an idempotency key", async () => {
  let request;
  const api = createPatientAppointmentApi({
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json(
        { code: "OK", data: appointmentDto },
        { status: 201 },
      );
    },
  });

  await api.book({ slotId: "slot-1", idempotencyKey: "request-12345678" });
  assert.equal(request.url, "/api/v1/patient/appointments");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["Idempotency-Key"], "request-12345678");
  assert.deepEqual(JSON.parse(request.options.body), { slotId: "slot-1" });
});

test("patient appointment lookup and cancellation use patient-scoped application paths", async () => {
  const calls = [];
  const api = createPatientAppointmentApi({
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method || "GET" });
      return Response.json({
        code: "OK",
        data: options.method === "POST" ? appointmentDto : [appointmentDto],
      });
    },
  });

  await api.appointments();
  await api.cancel("OPD/1");
  assert.deepEqual(calls, [
    { url: "/api/v1/patient/appointments", method: "GET" },
    { url: "/api/v1/patient/appointments/OPD%2F1/cancel", method: "POST" },
  ]);
});

test("EHR conflicts are preserved as retryable application errors", async () => {
  const api = createPatientAppointmentApi({
    fetchImpl: async () =>
      Response.json({ code: "CONFLICT", message: "号源已满" }, { status: 409 }),
  });

  await assert.rejects(api.appointments(), (error) => {
    assert.ok(error instanceof PatientAppointmentApiError);
    assert.equal(error.status, 409);
    assert.equal(error.message, "号源已满");
    return true;
  });
});
