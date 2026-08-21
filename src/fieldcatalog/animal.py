from __future__ import annotations

BIRD = set(
    """albatross auk auklet avocet bittern blackbird bluebird bobolink bobwhite bufflehead bunting bushtit
    canvasback caracara cardinal catbird chickadee condor coot cormorant cowbird crane creeper crossbill crow
    cuckoo curlew dipper dove dowitcher duck dunlin eagle egret eider falcon finch flamingo flicker flycatcher
    gadwall gallinule gnatcatcher godwit goldeneye goldfinch goose goshawk grackle grebe grosbeak grouse gull
    harrier hawk heron hummingbird ibis jaeger jay junco kestrel killdeer kingbird kingfisher kinglet kite knot
    lark loon magpie mallard martin meadowlark merganser merlin mockingbird murre nighthawk nutcracker nuthatch
    oriole osprey ovenbird owl oystercatcher pelican pewee phalarope pheasant phoebe pigeon pintail pipit plover
    ptarmigan puffin quail rail raven redhead roadrunner robin sanderling sandpiper sapsucker scaup scoter shrike
    siskin skimmer snipe sparrow starling stilt stork swallow swan swift tanager teal tern thrasher thrush
    titmouse towhee turkey turnstone veery vireo vulture warbler waxwing wigeon willet woodcock woodpecker wren
    yellowthroat raptor seabird shorebird waterfowl songbird passerine""".split()
)
MAMMAL = set(
    """mammal deer mule elk moose caribou pronghorn bighorn sheep goat coyote wolf fox bobcat lynx cougar puma
    lion raccoon ringtail skunk otter weasel mink badger bear squirrel chipmunk marmot gopher beaver muskrat
    porcupine rabbit cottontail jackrabbit hare pika bat mouse rat vole shrew mole opossum seal sealion dolphin
    porpoise whale seaotter horse cow pig cat dog""".split()
)
HERP = set(
    """herp reptile amphibian snake lizard turtle tortoise frog toad salamander newt gecko iguana rattlesnake
    kingsnake alligator crocodile skink anole""".split()
)
FISH = set("fish shark ray trout bass salmon tuna sunfish gar pike perch".split())
INVERT = set(
    """invertebrate insect butterfly moth dragonfly damselfly bee wasp hornet spider crab lobster shrimp beetle
    ant grasshopper cricket scorpion""".split()
)
ALIAS = {
    "bird": "bird",
    "birds": "bird",
    "avian": "bird",
    "mammal": "mammal",
    "mammals": "mammal",
    "herp": "herp",
    "reptile": "herp",
    "amphibian": "herp",
    "fish": "fish",
    "invertebrate": "invertebrate",
    "insect": "invertebrate",
    "other": "other",
}


def infer_animal_type(*parts: str | None) -> str | None:
    blob = " ".join(p for p in parts if p).lower().replace("'", "")
    blob = blob.replace("mountain lion", "lion").replace("sea lion", "sealion").replace("blue jay", "jay")
    words = [w for w in blob.replace("-", " ").split() if len(w) > 2]
    if any(w in MAMMAL for w in words):
        return "mammal"
    if any(w in HERP for w in words):
        return "herp"
    if any(w in FISH for w in words):
        return "fish"
    if any(w in BIRD or w.endswith("bird") for w in words):
        return "bird"
    if any(w in INVERT for w in words):
        return "invertebrate"
    return ALIAS.get(blob.strip())
