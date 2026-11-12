const paths = {
  slots: "/api/v1/patient/appointment-slots",
  appointments: "/api/v1/patient/appointments",
};

const registrationStatus = {
  REGISTERED: "booked",
  IN_CONSULT: "in-progress",
  FINISHED: "completed",
  CANCELLED: "cancelled",
};

export class PatientAppointmentApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "PatientAppointmentApiError";
    this.status = status;
  }
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`EHR response is missing ${field}`);
  }
  return value;
}

export function mapEhrSlot(dto) {
  const remaining = Number(dto.remainingSeats);
  if (!Number.isSafeInteger(remaining) || remaining < 0) {
    throw new TypeError("EHR response has invalid remainingSeats");
  }
  return {
    id: requiredString(dto.slotId, "slotId"),
    department: {
      code: requiredString(dto.departmentCode, "departmentCode"),
      name: requiredString(dto.departmentName, "departmentName"),
    },
    clinician: {
      code: requiredString(dto.doctorCode, "doctorCode"),
      name: requiredString(dto.doctorName, "doctorName"),
    },
    visitDate: requiredString(dto.slotDate, "slotDate"),
    period: requiredString(dto.period, "period"),
    remaining,
    state: dto.status === "OPEN" && remaining > 0 ? "available" : "unavailable",
  };
}

export function mapEhrAppointment(dto) {
  const status = registrationStatus[dto.status];
  if (!status)
    throw new TypeError("EHR response has unknown registration status");
  return {
    id: requiredString(dto.appointmentNo, "appointmentNo"),
    slotId: requiredString(dto.slotId, "slotId"),
    department: {
      code: requiredString(dto.departmentCode, "departmentCode"),
      name: requiredString(dto.departmentName, "departmentName"),
    },
    clinician: {
      code: requiredString(dto.doctorCode, "doctorCode"),
      name: requiredString(dto.doctorName, "doctorName"),
    },
    visitDate: requiredString(dto.slotDate, "slotDate"),
    period: requiredString(dto.period, "period"),
    status,
    createdAt: requiredString(dto.registeredAt, "registeredAt"),
  };
}

export function createPatientAppointmentApi({
  baseUrl = "",
  fetchImpl = fetch,
} = {}) {
  const base = baseUrl.replace(/\/$/, "");

  async function request(path, options = {}) {
    let response;
    const { headers, ...requestOptions } = options;
    try {
      response = await fetchImpl(`${base}${path}`, {
        credentials: "same-origin",
        ...requestOptions,
        headers: { Accept: "application/json", ...headers },
      });
    } catch {
      throw new PatientAppointmentApiError("EHR 服务暂时不可达", null);
    }

    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      throw new PatientAppointmentApiError(
        body?.message || `EHR 请求失败（HTTP ${response.status}）`,
        response.status,
      );
    }
    if (body?.code !== "OK" || body.data === undefined || body.data === null) {
      throw new PatientAppointmentApiError(
        "EHR 返回了无法识别的数据格式",
        response.status,
      );
    }
    return body.data;
  }

  return {
    async slots({ fromDate, toDate, departmentCode, doctorCode } = {}) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries({
        fromDate,
        toDate,
        departmentCode,
        doctorCode,
      })) {
        if (value) query.set(key, value);
      }
      const suffix = query.size ? `?${query}` : "";
      const rows = await request(`${paths.slots}${suffix}`);
      if (!Array.isArray(rows))
        throw new PatientAppointmentApiError("EHR 号源响应不是列表", 200);
      return rows.map(mapEhrSlot);
    },

    async appointments() {
      const rows = await request(paths.appointments);
      if (!Array.isArray(rows))
        throw new PatientAppointmentApiError("EHR 预约响应不是列表", 200);
      return rows.map(mapEhrAppointment);
    },

    async book({ slotId, idempotencyKey }) {
      if (!slotId || !idempotencyKey)
        throw new TypeError("slotId 和 idempotencyKey 必填");
      const dto = await request(paths.appointments, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ slotId }),
      });
      return mapEhrAppointment(dto);
    },

    async cancel(appointmentId) {
      if (!appointmentId) throw new TypeError("appointmentId 必填");
      const dto = await request(
        `${paths.appointments}/${encodeURIComponent(appointmentId)}/cancel`,
        {
          method: "POST",
        },
      );
      return mapEhrAppointment(dto);
    },
  };
}
