export function mediaStatusLabel(status: string): string {
  switch (status) {
    case "pending":
    case "processing":
      return "Processando";
    case "ready":
      return "Pronta";
    case "failed":
      return "Erro";
    case "duplicate":
      return "Duplicata";
    default:
      return status;
  }
}
