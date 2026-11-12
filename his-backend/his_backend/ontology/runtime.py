from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from rdflib import Graph, Namespace, RDF, RDFS, URIRef
from rdflib.namespace import OWL

HIS = Namespace("urn:his:core:")
_ONTOLOGY_FILE = Path(__file__).with_name("his-core.ttl")


class OntologyValidationError(ValueError):
    """An assertion uses an undefined or semantically incompatible HIS relation."""


@dataclass(frozen=True, slots=True)
class RelationDefinition:
    uri: str
    label: str
    domain: str
    range: str


@lru_cache(maxsize=1)
def ontology_graph() -> Graph:
    return Graph().parse(_ONTOLOGY_FILE, format="turtle")


def _local_name(uri: URIRef) -> str:
    return str(uri).removeprefix(str(HIS))


def _label(graph: Graph, uri: URIRef) -> str:
    return str(next(iter(graph.objects(uri, RDFS.label)), _local_name(uri)))


def _is_class(graph: Graph, uri: URIRef) -> bool:
    return (uri, RDF.type, OWL.Class) in graph


def _is_subclass(graph: Graph, actual: URIRef, expected: URIRef) -> bool:
    if actual == expected:
        return True
    pending = [actual]
    visited: set[URIRef] = set()
    while pending:
        current = pending.pop()
        if current in visited:
            continue
        visited.add(current)
        parents = tuple(graph.objects(current, RDFS.subClassOf))
        if expected in parents:
            return True
        pending.extend(parent for parent in parents if isinstance(parent, URIRef))
    return False


def list_classes() -> list[dict[str, str]]:
    graph = ontology_graph()
    return sorted(
        (
            {"uri": str(uri), "name": _local_name(uri), "label": _label(graph, uri)}
            for uri in graph.subjects(RDF.type, OWL.Class)
        ),
        key=lambda item: item["name"],
    )


def list_relations() -> list[RelationDefinition]:
    graph = ontology_graph()
    definitions = []
    for uri in graph.subjects(RDF.type, OWL.ObjectProperty):
        domain = next(graph.objects(uri, RDFS.domain), None)
        range_ = next(graph.objects(uri, RDFS.range), None)
        if not isinstance(domain, URIRef) or not isinstance(range_, URIRef):
            continue
        definitions.append(
            RelationDefinition(
                uri=str(uri),
                label=_label(graph, uri),
                domain=_local_name(domain),
                range=_local_name(range_),
            )
        )
    return sorted(definitions, key=lambda item: item.uri)


def validate_relation(subject_type: str, predicate: str, object_type: str) -> None:
    graph = ontology_graph()
    subject_class = HIS[subject_type]
    object_class = HIS[object_type]
    relation = HIS[predicate]
    if not _is_class(graph, subject_class):
        raise OntologyValidationError(f"Unknown HIS class: {subject_type}")
    if not _is_class(graph, object_class):
        raise OntologyValidationError(f"Unknown HIS class: {object_type}")
    if (relation, RDF.type, OWL.ObjectProperty) not in graph:
        raise OntologyValidationError(f"Unknown HIS relation: {predicate}")

    expected_subject = next(graph.objects(relation, RDFS.domain), None)
    expected_object = next(graph.objects(relation, RDFS.range), None)
    if not isinstance(expected_subject, URIRef) or not isinstance(expected_object, URIRef):
        raise OntologyValidationError(f"Relation has no domain/range definition: {predicate}")
    if not _is_subclass(graph, subject_class, expected_subject):
        raise OntologyValidationError(
            f"{subject_type} cannot be used as the subject of {predicate}; expected {_local_name(expected_subject)}"
        )
    if not _is_subclass(graph, object_class, expected_object):
        raise OntologyValidationError(
            f"{object_type} cannot be used as the object of {predicate}; expected {_local_name(expected_object)}"
        )
