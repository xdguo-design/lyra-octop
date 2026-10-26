let validationModule
let validationPromise

export function loadValidation() {
  validationPromise ||= import('./validation.js').then((module) => {
    validationModule = module
    return module
  })
  return validationPromise
}

export function validateFields(...args) {
  if (!validationModule) throw new Error('Admission validation has not been loaded')
  return validationModule.validateFields(...args)
}

export async function findRegionMismatch(text) {
  return (await loadValidation()).findRegionMismatch(text)
}
